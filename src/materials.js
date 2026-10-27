import * as THREE from 'three';
import { atlasCanvas } from './textures.js';
import { DYN_SIZE, dynData } from './lighting.js';

export const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
atlasTexture.magFilter = THREE.NearestFilter;
atlasTexture.minFilter = THREE.NearestFilter;
atlasTexture.generateMipmaps = false;
atlasTexture.colorSpace = THREE.NoColorSpace;

// Dynamic light volume around the player (held torch, glowing mobs), flood-filled on the CPU.
// Texel layout: x = world x, y = world z, z = world y.
export const dynLightTexture = new THREE.Data3DTexture(dynData, DYN_SIZE, DYN_SIZE, DYN_SIZE);
dynLightTexture.format = THREE.RedFormat;
dynLightTexture.type = THREE.UnsignedByteType;
dynLightTexture.magFilter = THREE.LinearFilter;
dynLightTexture.minFilter = THREE.LinearFilter;
dynLightTexture.unpackAlignment = 1;
dynLightTexture.colorSpace = THREE.NoColorSpace;
dynLightTexture.needsUpdate = true;

// Shared uniforms so day/night, fog and lights update every chunk at once.
export const worldUniforms = {
  map: { value: atlasTexture },
  uSkyLight: { value: new THREE.Color(1, 1, 1) },
  uFogColor: { value: new THREE.Color(0.6, 0.75, 1) },
  uFogNear: { value: 60 },
  uFogFar: { value: 100 },
  uDynLight: { value: dynLightTexture },
  uDynOrigin: { value: new THREE.Vector3() },
  uDynOn: { value: 0 },
};

const vertexShader = /* glsl */ `
  attribute vec3 aLight;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vWorld;
  varying float vDist;
  void main() {
    vUv = uv;
    vLight = aLight;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp sampler3D;
  uniform sampler2D map;
  uniform sampler3D uDynLight;
  uniform vec3 uDynOrigin;
  uniform float uDynOn;
  uniform vec3 uSkyLight;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;
  uniform float uAlphaTest;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vWorld;
  varying float vDist;
  void main() {
    vec4 tex = texture2D(map, vUv);
    if (tex.a < uAlphaTest) discard;
    // Minecraft-like exponential light curve (level 15 -> 1.0, level 0 -> ~0.035).
    float sky = pow(0.8, (1.0 - vLight.y) * 15.0);
    float blockLevel = vLight.z;
    if (uDynOn > 0.5) {
      // Sample the cell in front of the face (flat normal from screen-space derivatives).
      vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
      vec3 p = (vWorld + n * 0.5 - uDynOrigin) / ${DYN_SIZE.toFixed(1)};
      if (all(greaterThan(p, vec3(0.0))) && all(lessThan(p, vec3(1.0)))) {
        blockLevel = max(blockLevel, texture(uDynLight, p.xzy).r * 255.0 / 17.0 / 15.0);
      }
    }
    float blk = blockLevel > 0.0 ? pow(0.8, (1.0 - blockLevel) * 15.0) : 0.0;
    vec3 light = max(uSkyLight * sky, vec3(1.0, 0.86, 0.66) * blk);
    light = max(light, vec3(0.035));
    vec3 col = tex.rgb * light * vLight.x;
    float fog = smoothstep(uFogNear, uFogFar, vDist);
    gl_FragColor = vec4(mix(col, uFogColor, fog), tex.a * uOpacity);
  }
`;

export const opaqueMaterial = new THREE.ShaderMaterial({
  uniforms: { ...worldUniforms, uOpacity: { value: 1 }, uAlphaTest: { value: 0.5 } },
  vertexShader,
  fragmentShader,
});

export const waterMaterial = new THREE.ShaderMaterial({
  uniforms: { ...worldUniforms, uOpacity: { value: 0.72 }, uAlphaTest: { value: 0.01 } },
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});
