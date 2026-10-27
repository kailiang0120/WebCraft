import { getItem } from './blocks.js';
import { tileCanvas } from './textures.js';

const cache = new Map();
const S = 64;

function shaded(name, f) {
  const c = tileCanvas(name);
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, 16, 16);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] *= f; img.data[i + 1] *= f; img.data[i + 2] *= f;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function drawIso(def) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const k = (S - 4) / 2 / 16; // pixel scale of a face edge
  const top = shaded(def.tex.top, 1);
  const left = shaded(def.tex.front, 0.78);
  const right = shaded(def.tex.side, 0.6);
  const h = k * 8; // vertical skew
  // top face: origin left vertex, u -> up-right, v -> down-right
  ctx.setTransform(k, -k / 2, k, k / 2, 2, 2 + h);
  ctx.drawImage(top, 0, 0);
  // left face
  ctx.setTransform(k, k / 2, 0, k, 2, 2 + h);
  ctx.drawImage(left, 0, 0);
  // right face
  ctx.setTransform(k, -k / 2, 0, k, 2 + 16 * k, 2 + h + 8 * k);
  ctx.drawImage(right, 0, 0);
  return c;
}

function drawFlat(name) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tileCanvas(name), 0, 0, S, S);
  return c;
}

export function itemIconCanvas(id) {
  const def = getItem(id);
  if (def.isBlock && !def.flatIcon) return drawIso(def);
  return drawFlat(def.icon);
}

export function itemIcon(id) {
  let url = cache.get(id);
  if (!url) {
    url = itemIconCanvas(id).toDataURL();
    cache.set(id, url);
  }
  return url;
}
