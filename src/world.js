import * as THREE from 'three';
import { CHUNK, HEIGHT, idx } from './constants.js';
import { B, BLOCKS, isFluid } from './blocks.js';
import { opaqueMaterial, waterMaterial } from './materials.js';
import { rleEncode, rleDecode } from './storage.js';
import { LIGHT_EMIT, LIT_FURNACE_LIGHT, MAX_LIGHT_REACH, lightAttenuation } from './lighting.js';

export const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const LIGHT = new Uint8Array(256);
BLOCKS.forEach((d, i) => { if (d?.light) LIGHT[i] = 1; });
const FLOWING = new Uint8Array(256);
BLOCKS.forEach((d, i) => { if (d?.fluid && d.level > 0) FLOWING[i] = 1; });
const CHUNK_VOLUME = CHUNK * CHUNK * HEIGHT;
const JOBS_PER_MESH_WORKER = 2;

export class World {
  constructor(scene, seed, storage) {
    this.scene = scene;
    this.seed = seed;
    this.storage = storage;
    this.chunks = new Map();
    this.pending = new Set();
    this.entities = new Map(); // "x,y,z" -> block entity (furnace, chest)
    this.renderDistance = 6;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.queue = [];
    this.saveQueue = new Set();
    this.center = [0, 0];
    this.scanTimer = 0;
    this.disposed = false;
    this.onChange = null; // (x, y, z, oldId, newId) — used by the fluid simulation
    this.flowingFound = []; // flowing water found in freshly loaded chunks (resume their simulation)
    this.firesFound = []; // likewise for fire

    const cores = navigator.hardwareConcurrency || 4;
    // Terrain generation workers.
    this.workers = [];
    for (let i = 0; i < Math.max(1, Math.min(3, cores - 2)); i++) {
      const w = new Worker(new URL('./worldgen.worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => {
        w.busy = false;
        if (!this.disposed) this.addChunk(e.data.cx, e.data.cz, e.data.blocks);
      };
      this.workers.push(w);
    }
    // Lighting + meshing workers.
    this.meshWorkers = [];
    for (let i = 0; i < (cores >= 6 ? 3 : 2); i++) {
      const w = new Worker(new URL('./mesh.worker.js', import.meta.url), { type: 'module' });
      w.jobs = 0;
      w.onmessage = (e) => {
        w.jobs--;
        if (!this.disposed) this.onMeshed(e.data);
      };
      this.meshWorkers.push(w);
    }
  }

  // ---------- block access ----------
  getChunk(cx, cz) {
    return this.chunks.get(ckey(cx, cz));
  }

  isLoaded(x, z) {
    return this.chunks.has(ckey(Math.floor(x) >> 4, Math.floor(z) >> 4));
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return c ? c.blocks[idx(x & 15, y, z & 15)] : B.AIR;
  }

  // Unloaded chunks count as solid so the player can't fall out of the world.
  isSolid(x, y, z) {
    if (y < 0) return true;
    if (y >= HEIGHT) return false;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c) return true;
    return BLOCKS[c.blocks[idx(x & 15, y, z & 15)]].solid;
  }

  // urgent: remesh this frame (player edits). Background changes (flowing water) pass false.
  setBlock(x, y, z, id, urgent = true) {
    if (y < 0 || y >= HEIGHT) return false;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (!c) return false;
    const lx = x & 15, lz = z & 15;
    const i = idx(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    if (LIGHT[old]) c.torches.delete(i);
    if (LIGHT[id]) c.torches.add(i);
    this.saveQueue.add(c);
    this.markDirty(x, y, z, urgent);
    // Emitters or light attenuation changed: sky & block light can shift up to 15 blocks away.
    if (LIGHT_EMIT[old] !== LIGHT_EMIT[id] || lightAttenuation(old) !== lightAttenuation(id)) this.markLightChange(x, z);
    this.onChange?.(x, y, z, old, id);
    return true;
  }

  getBlockLight(x, y, z) {
    if (y < 0 || y >= HEIGHT) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    return c?.blockLight ? c.blockLight[idx(x & 15, y, z & 15)] : 0;
  }

  // Flood-filled sky light (0..15) if the chunk has been lit, else a direct-exposure estimate.
  getSkyLight(x, y, z) {
    if (y >= HEIGHT) return 15;
    if (y < 0) return 0;
    const c = this.chunks.get(ckey(x >> 4, z >> 4));
    if (c?.skyLight) return c.skyLight[idx(x & 15, y, z & 15)];
    return y > this.getSkyY(x, z) ? 15 : 0;
  }

  // Remesh (and relight) every chunk within light reach of a column.
  markLightChange(x, z) {
    const R = MAX_LIGHT_REACH;
    for (let cz = (z - R) >> 4; cz <= (z + R) >> 4; cz++) {
      for (let cx = (x - R) >> 4; cx <= (x + R) >> 4; cx++) {
        const c = this.chunks.get(ckey(cx, cz));
        if (c) c.dirty = true;
      }
    }
  }

  markDirty(x, y, z, urgent = true) {
    const cx = x >> 4, cz = z >> 4, lx = x & 15, lz = z & 15;
    const dxs = [0], dzs = [0];
    if (lx === 0) dxs.push(-1); else if (lx === 15) dxs.push(1);
    if (lz === 0) dzs.push(-1); else if (lz === 15) dzs.push(1);
    for (const dx of dxs) {
      for (const dz of dzs) {
        const n = this.chunks.get(ckey(cx + dx, cz + dz));
        if (n) { n.dirty = true; if (urgent) n.urgent = true; }
      }
    }
  }

  // Highest sky-blocking (opaque cube) block in a column.
  getSkyY(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const d = BLOCKS[this.getBlock(x, y, z)];
      if (d.opaque && d.render === 'cube') return y;
    }
    return -1;
  }

  getTopY(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (BLOCKS[id].solid || isFluid(id)) return y;
    }
    return 0;
  }

  // ---------- block entities ----------
  entityKey(x, y, z) { return `${x},${y},${z}`; }
  getEntity(x, y, z) { return this.entities.get(this.entityKey(x, y, z)); }
  setEntity(x, y, z, e) {
    const key = this.entityKey(x, y, z);
    if (this.entities.get(key)?.lit) this.markLightChange(x, z); // a glowing furnace went away
    if (e) this.entities.set(key, e);
    else this.entities.delete(key);
  }

  // ---------- chunk streaming ----------
  requestChunk(cx, cz) {
    const k = ckey(cx, cz);
    this.pending.add(k);
    const fallback = () => this.queue.push([cx, cz]);
    this.storage.getChunk(`${cx},${cz}`).then((data) => {
      if (this.disposed) return;
      if (data) this.addChunk(cx, cz, rleDecode(data, CHUNK_VOLUME));
      else fallback();
    }, fallback);
  }

  addChunk(cx, cz, blocks) {
    const k = ckey(cx, cz);
    this.pending.delete(k);
    if (this.chunks.has(k)) return;
    const chunk = {
      cx, cz, key: k, blocks, mesh: null, water: null, dirty: true, urgent: false, inflight: false,
      meshed: false, torches: new Set(), blockLight: null, skyLight: null,
    };
    for (let i = 0; i < blocks.length; i++) {
      const id = blocks[i];
      if (LIGHT[id]) {
        chunk.torches.add(i);
        if (id === B.FIRE) this.firesFound.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)]);
      }
      if (FLOWING[id]) this.flowingFound.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)]);
    }
    this.chunks.set(k, chunk);
  }

  hasNeighbours(c) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!this.chunks.has(ckey(c.cx + dx, c.cz + dz))) return false;
      }
    }
    return true;
  }

  update(dt, px, pz) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.renderDistance;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0 || pcx !== this.center[0] || pcz !== this.center[1]) {
      this.scanTimer = 0.5;
      this.center = [pcx, pcz];
      const loadR = R + 1.5;
      for (let dz = -R - 1; dz <= R + 1; dz++) {
        for (let dx = -R - 1; dx <= R + 1; dx++) {
          if (dx * dx + dz * dz > loadR * loadR) continue;
          const k = ckey(pcx + dx, pcz + dz);
          if (!this.chunks.has(k) && !this.pending.has(k)) this.requestChunk(pcx + dx, pcz + dz);
        }
      }
      const unloadR = R + 3;
      for (const c of this.chunks.values()) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > unloadR * unloadR) this.unload(c);
      }
      this.queue = this.queue.filter(([cx, cz]) => {
        const dx = cx - pcx, dz = cz - pcz;
        const keep = dx * dx + dz * dz <= (loadR + 1) * (loadR + 1);
        if (!keep) this.pending.delete(ckey(cx, cz));
        return keep;
      });
      this.queue.sort((a, b) => ((a[0] - pcx) ** 2 + (a[1] - pcz) ** 2) - ((b[0] - pcx) ** 2 + (b[1] - pcz) ** 2));
    }

    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const [cx, cz] = this.queue.shift();
      w.busy = true;
      w.postMessage({ seed: this.seed, cx, cz });
    }

    // Meshing jobs: player edits first, then nearest dirty chunks, while workers have capacity.
    const cands = [];
    for (const c of this.chunks.values()) {
      if (!c.dirty || c.inflight) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      const d2 = dx * dx + dz * dz;
      if (d2 > (R + 0.5) * (R + 0.5) || !this.hasNeighbours(c)) continue;
      cands.push([c.urgent ? -1 : d2, c]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [, c] of cands) {
      const w = this.meshWorkers.reduce((a, b) => (b.jobs < a.jobs ? b : a));
      if (w.jobs >= JOBS_PER_MESH_WORKER && !c.urgent) break;
      this.dispatchMesh(c, w);
    }
  }

  // Light sources in the 3x3 chunks around c, in working-volume coordinates.
  // Flat [x, y, z, level, ...] (compact to post to the worker — lava lakes have many emitters).
  lightSources(c) {
    const out = [];
    const vx0 = (c.cx - 1) * CHUNK, vz0 = (c.cz - 1) * CHUNK;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
        for (const i of n.torches) {
          out.push((dx + 1) * 16 + (i & 15), i >> 8, (dz + 1) * 16 + ((i >> 4) & 15), LIGHT_EMIT[n.blocks[i]]);
        }
      }
    }
    for (const e of this.entities.values()) {
      if (!e.lit) continue;
      const x = e.pos[0] - vx0, z = e.pos[2] - vz0;
      if (x >= 0 && x < 48 && z >= 0 && z < 48) out.push(x, e.pos[1], z, LIT_FURNACE_LIGHT);
    }
    return Int16Array.from(out);
  }

  dispatchMesh(c, worker) {
    const nb = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(this.chunks.get(ckey(c.cx + dx, c.cz + dz)).blocks);
    // Facing / lit state of furnaces & chests inside this chunk.
    const entities = {};
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    for (const e of this.entities.values()) {
      const lx = e.pos[0] - x0, lz = e.pos[2] - z0;
      if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) entities[`${lx},${e.pos[1]},${lz}`] = { facing: e.facing, lit: !!e.lit };
    }
    c.dirty = false;
    c.urgent = false;
    c.inflight = true;
    worker.jobs++;
    worker.postMessage({ key: c.key, nb, sources: this.lightSources(c), entities });
  }

  onMeshed({ key, opaque, water, blockLight, skyLight }) {
    const c = this.chunks.get(key);
    if (!c) return; // unloaded meanwhile
    c.inflight = false;
    c.meshed = true;
    c.blockLight = blockLight;
    c.skyLight = skyLight;
    c.mesh = this.applyMesh(c, c.mesh, opaque, opaqueMaterial);
    c.water = this.applyMesh(c, c.water, water, waterMaterial);
  }

  applyMesh(c, mesh, data, material) {
    if (mesh) mesh.geometry.dispose();
    if (!data) {
      if (mesh) this.group.remove(mesh);
      return null;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    g.setAttribute('aLight', new THREE.BufferAttribute(data.light, 3));
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    if (!mesh) {
      mesh = new THREE.Mesh(g, material);
      mesh.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
    } else {
      mesh.geometry = g;
    }
    return mesh;
  }

  unload(c) {
    if (this.saveQueue.has(c)) {
      this.storage.putChunk(`${c.cx},${c.cz}`, rleEncode(c.blocks));
      this.saveQueue.delete(c);
    }
    for (const m of [c.mesh, c.water]) {
      if (m) { m.geometry.dispose(); this.group.remove(m); }
    }
    this.chunks.delete(c.key);
  }

  async saveChunks() {
    const jobs = [];
    for (const c of this.saveQueue) jobs.push(this.storage.putChunk(`${c.cx},${c.cz}`, rleEncode(c.blocks)));
    this.saveQueue.clear();
    await Promise.all(jobs);
  }

  dispose() {
    this.disposed = true;
    for (const w of [...this.workers, ...this.meshWorkers]) w.terminate();
    for (const c of this.chunks.values()) {
      for (const m of [c.mesh, c.water]) if (m) m.geometry.dispose();
    }
    this.scene.remove(this.group);
    this.chunks.clear();
  }
}
