import * as THREE from 'three';

const MAX = 400;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

// Little cubes that fly out of broken blocks.
export class Particles {
  constructor(scene) {
    this.material = new THREE.MeshBasicMaterial();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), this.material, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, tmpC.set(1, 1, 1));
    scene.add(this.mesh);
    this.list = [];
  }

  spawn(x, y, z, rgb, n = 18, spread = 1) {
    for (let i = 0; i < n && this.list.length < MAX; i++) {
      const s = 0.65 + Math.random() * 0.45;
      this.list.push({
        p: new THREE.Vector3(x + 0.5 + (Math.random() - 0.5) * spread, y + 0.5 + (Math.random() - 0.5) * spread, z + 0.5 + (Math.random() - 0.5) * spread),
        v: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4),
        life: 0.5 + Math.random() * 0.6,
        c: [rgb[0] * s, rgb[1] * s, rgb[2] * s],
      });
    }
  }

  update(dt, world, brightness) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const q = list[i];
      q.life -= dt;
      if (q.life <= 0) { list.splice(i, 1); continue; }
      q.v.y -= 22 * dt;
      const nx = q.p.x + q.v.x * dt, ny = q.p.y + q.v.y * dt, nz = q.p.z + q.v.z * dt;
      if (world.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
        q.v.multiplyScalar(0.3);
        q.v.y = 0;
      } else q.p.set(nx, ny, nz);
    }
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      const sc = Math.min(1, q.life * 4);
      tmpM.compose(q.p, tmpQ, tmpS.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, tmpM);
      this.mesh.setColorAt(i, tmpC.setRGB(q.c[0], q.c[1], q.c[2]));
    }
    this.mesh.count = list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.material.color.setScalar(brightness);
  }
}
