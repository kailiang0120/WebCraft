import { TerrainGenerator } from './terrain.js';

let gen = null;

self.onmessage = (e) => {
  const { seed, cx, cz } = e.data;
  if (!gen || gen.seed !== (seed | 0)) gen = new TerrainGenerator(seed);
  const blocks = gen.generate(cx, cz);
  self.postMessage({ cx, cz, blocks }, [blocks.buffer]);
};
