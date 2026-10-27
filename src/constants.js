export const CHUNK = 16;
export const HEIGHT = 128;
export const SEA_LEVEL = 62;

// Chunk-local block index: x + z*16 + y*256
export const idx = (x, y, z) => x | (z << 4) | (y << 8);
