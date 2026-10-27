// Off-main-thread chunk lighting + meshing.
import { buildPad, meshChunk } from './mesher.js';
import { computeChunkLight } from './lighting.js';

self.onmessage = (e) => {
  const { key, nb, sources, entities } = e.data;
  const pad = buildPad(nb);
  const light = computeChunkLight(nb, sources);
  const res = meshChunk(pad, light.padBlock, light.padSky, (lx, y, lz) => entities[`${lx},${y},${lz}`]);
  const transfer = [light.chunkBlock.buffer, light.chunkSky.buffer];
  for (const part of [res.opaque, res.water]) {
    if (part) transfer.push(part.position.buffer, part.uv.buffer, part.light.buffer, part.index.buffer);
  }
  self.postMessage({ key, opaque: res.opaque, water: res.water, blockLight: light.chunkBlock, skyLight: light.chunkSky }, transfer);
};
