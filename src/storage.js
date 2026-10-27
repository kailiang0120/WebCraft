// IndexedDB persistence: world metadata + RLE-compressed modified chunks.

const DB_NAME = 'webcraft';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 255) n++;
    out.push(n, v);
    i += n;
  }
  return new Uint8Array(out);
}

export function rleDecode(data, size) {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < data.length; i += 2) {
    out.fill(data[i + 1], o, o + data[i]);
    o += data[i];
  }
  return out;
}

export class Storage {
  constructor() {
    this.db = null;
  }

  async open() {
    if (!('indexedDB' in window)) return;
    try {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('meta');
        r.result.createObjectStore('chunks');
      };
      this.db = await req(r);
    } catch (e) {
      console.warn('IndexedDB unavailable, progress will not be saved', e);
      this.db = null;
    }
  }

  async get(store, key) {
    if (!this.db) return undefined;
    return req(this.db.transaction(store, 'readonly').objectStore(store).get(key));
  }

  async put(store, key, value) {
    if (!this.db) return;
    return req(this.db.transaction(store, 'readwrite').objectStore(store).put(value, key));
  }

  getMeta() { return this.get('meta', 'world'); }
  putMeta(meta) { return this.put('meta', 'world', meta); }
  getChunk(key) { return this.get('chunks', key); }
  putChunk(key, data) { return this.put('chunks', key, data); }

  async clear() {
    if (!this.db) return;
    const tx = this.db.transaction(['meta', 'chunks'], 'readwrite');
    tx.objectStore('meta').clear();
    tx.objectStore('chunks').clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
}
