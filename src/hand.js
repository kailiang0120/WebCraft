import * as THREE from 'three';
import { getItem } from './blocks.js';
import { atlasTexture } from './materials.js';
import { tileIndex, tileUV } from './textures.js';
import { itemIconCanvas } from './icons.js';

// First-person held item / arm, rendered in its own overlay scene.
export class Hand {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.current = undefined;
    this.swingT = 1;
    this.equipT = 1;
    this.blockMat = new THREE.MeshBasicMaterial({ map: atlasTexture, alphaTest: 0.5 });
    this.armMat = new THREE.MeshBasicMaterial({ color: 0xc69c7a });
    this.flatMats = [];
    this.cache = new Map();
  }

  swing() {
    if (this.swingT >= 0.6) this.swingT = 0;
  }

  build(id) {
    if (id == null) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7), this.armMat);
      arm.position.set(0.48, -0.5, -0.62);
      arm.rotation.set(0.35, -0.12, 0.05);
      return arm;
    }
    const def = getItem(id);
    if (def.isBlock && !def.flatIcon) {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const t = def.tex;
      const tiles = [t.side, t.side, t.top, t.bottom, t.front, t.side].map(tileIndex);
      const uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) {
        const [u0, v0, u1, v1] = tileUV(tiles[f]);
        for (let k = 0; k < 4; k++) {
          const i = f * 4 + k;
          uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
        }
      }
      const m = new THREE.Mesh(g, this.blockMat);
      m.scale.setScalar(0.4);
      m.position.set(0.55, -0.48, -0.85);
      m.rotation.set(0, Math.PI / 4, 0);
      return m;
    }
    const tex = new THREE.CanvasTexture(itemIconCanvas(id));
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.NoColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.1, side: THREE.DoubleSide });
    this.flatMats.push(mat);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), mat);
    m.position.set(0.6, -0.38, -0.8);
    m.rotation.set(0, -Math.PI / 2.6, 0.15);
    return m;
  }

  setItem(id) {
    if (id === this.current) return;
    this.current = id;
    this.holder.clear();
    let obj = this.cache.get(id ?? 'arm');
    if (!obj) {
      obj = this.build(id);
      this.cache.set(id ?? 'arm', obj);
    }
    this.holder.add(obj);
    this.equipT = 0;
  }

  update(dt, brightness, walkDist, moving, aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.swingT = Math.min(1, this.swingT + dt * 3.2);
    this.equipT = Math.min(1, this.equipT + dt * 5);
    const s = Math.sin(this.swingT * Math.PI);
    const bob = moving ? walkDist * 2.2 : 0;
    this.holder.position.set(
      -s * 0.25 + Math.sin(bob) * 0.03,
      -s * 0.18 + Math.abs(Math.cos(bob)) * 0.03 - (1 - this.equipT) * 0.4,
      -s * 0.1,
    );
    this.holder.rotation.set(-s * 0.9, s * 0.4, 0);
    const u = this.use;
    if (u?.kind === 'eat') {
      // Bring the food to the mouth and bob.
      this.holder.position.x -= 0.32;
      this.holder.position.y += 0.12 + Math.abs(Math.sin(u.t * 14)) * 0.05;
      this.holder.rotation.set(0.2, 0.6, 0);
    } else if (u?.kind === 'bow') {
      const d = Math.min(1, u.t);
      this.holder.position.x -= 0.3;
      this.holder.position.z += d * 0.12;
      this.holder.rotation.set(0, 0.9, -0.3 + Math.sin(u.t * 30) * d * 0.01);
    }
    const b = Math.max(0.12, brightness);
    this.blockMat.color.setScalar(b);
    this.armMat.color.setRGB(0.78 * b, 0.61 * b, 0.48 * b);
    for (const m of this.flatMats) m.color.setScalar(b);
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
