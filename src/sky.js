import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const DAY = new THREE.Color(0.47, 0.66, 1.0);
const NIGHT = new THREE.Color(0.012, 0.016, 0.05);
const SUNSET = new THREE.Color(0.98, 0.55, 0.3);
const SKYLIGHT_DAY = new THREE.Color(1, 1, 1);
const SKYLIGHT_NIGHT = new THREE.Color(0.16, 0.18, 0.3);
const SKYLIGHT_SUNSET = new THREE.Color(1, 0.75, 0.6);

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function squareTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const mat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false });

    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(squareTexture((g) => {
      g.fillStyle = 'rgba(255,240,150,0.35)'; g.fillRect(4, 4, 24, 24);
      g.fillStyle = '#fff6c0'; g.fillRect(9, 9, 14, 14);
      g.fillStyle = '#ffffff'; g.fillRect(11, 11, 10, 10);
    })));
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), mat(squareTexture((g) => {
      g.fillStyle = '#d8dce8'; g.fillRect(8, 8, 16, 16);
      g.fillStyle = '#aeb3c4'; g.fillRect(11, 11, 4, 3); g.fillRect(17, 17, 5, 4); g.fillRect(13, 19, 3, 2);
    })));
    this.group.add(this.sun, this.moon);

    // Stars
    const rnd = mulberry32(99);
    const pts = [];
    for (let i = 0; i < 900; i++) {
      const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize().multiplyScalar(420);
      pts.push(v.x, v.y, v.z);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false,
    }));
    this.group.add(this.stars);

    // Blocky clouds: tiled texture on a large plane with distance fade.
    const cc = document.createElement('canvas');
    cc.width = cc.height = 64;
    const g = cc.getContext('2d');
    const r2 = mulberry32(7);
    const cells = new Uint8Array(64 * 64);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r2() * 64), y = Math.floor(r2() * 64);
      const w = 2 + Math.floor(r2() * 6), h = 2 + Math.floor(r2() * 4);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) cells[((y + yy) & 63) * 64 + ((x + xx) & 63)] = 1;
    }
    g.fillStyle = '#fff';
    for (let i = 0; i < cells.length; i++) if (cells[i]) g.fillRect(i & 63, i >> 6, 1, 1);
    this.cloudTex = new THREE.CanvasTexture(cc);
    this.cloudTex.magFilter = THREE.NearestFilter;
    this.cloudTex.minFilter = THREE.NearestFilter;
    this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.colorSpace = THREE.NoColorSpace;
    this.cloudSize = 1536;
    this.cloudScale = 12; // world units per cloud texel
    this.cloudUniforms = {
      map: { value: this.cloudTex },
      uOffset: { value: new THREE.Vector2() },
      uRepeat: { value: this.cloudSize / (64 * this.cloudScale) },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uFade: { value: 600 },
    };
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(this.cloudSize, this.cloudSize),
      new THREE.ShaderMaterial({
        uniforms: this.cloudUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `
          varying vec2 vUv; varying float vDist;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vDist = length(wp.xz - cameraPosition.xz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform sampler2D map; uniform vec2 uOffset; uniform float uRepeat; uniform vec3 uColor; uniform float uFade;
          varying vec2 vUv; varying float vDist;
          void main() {
            float a = texture2D(map, vUv * uRepeat + uOffset).a;
            a *= 0.8 * (1.0 - smoothstep(uFade * 0.4, uFade, vDist));
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor, a);
          }`,
      }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 120;
    scene.add(this.clouds);

    this.skyColor = new THREE.Color();
    this.lightColor = new THREE.Color();
    this.daylight = 1;
  }

  // time in [0,1): 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight.
  update(time, camera, elapsed) {
    const a = time * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.2).normalize();
    const h = sunDir.y;
    const day = smoothstep(-0.18, 0.22, h);
    const sunset = Math.max(0, 1 - Math.abs(h) / 0.3) * 0.7;

    this.skyColor.copy(NIGHT).lerp(DAY, day).lerp(SUNSET, sunset * 0.6);
    this.lightColor.copy(SKYLIGHT_NIGHT).lerp(SKYLIGHT_DAY, day).lerp(SKYLIGHT_SUNSET, sunset * 0.4);
    this.daylight = day;

    const cp = camera.position;
    this.group.position.copy(cp);
    this.sun.position.copy(sunDir).multiplyScalar(380);
    this.sun.lookAt(cp);
    this.moon.position.copy(sunDir).multiplyScalar(-380);
    this.moon.lookAt(cp);
    this.stars.material.opacity = Math.max(0, 1 - day * 1.6);
    this.stars.rotation.z = a;

    const s = this.cloudScale * 64;
    this.clouds.position.x = cp.x;
    this.clouds.position.z = cp.z;
    const wind = elapsed * 1.2;
    this.cloudUniforms.uOffset.value.set(((cp.x + wind) / s) % 1, (-cp.z / s) % 1);
    this.cloudUniforms.uColor.value.copy(this.lightColor).multiplyScalar(0.25 + 0.75 * day);
    return sunDir;
  }
}
