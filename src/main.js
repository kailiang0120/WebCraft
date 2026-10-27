import './setup.js';
import './style.css';
import { Storage } from './storage.js';
import { Game } from './game.js';
import { tileCanvas } from './textures.js';

const $ = (id) => document.getElementById(id);
const storage = new Storage();
let game = null;
let newMode = 'survival';

const SETTINGS_KEY = 'webcraft-settings';
const settings = {
  renderDistance: 6, fov: 75, sensitivity: 1, volume: 0.5,
  ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'),
};
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

function show(id) {
  for (const m of document.querySelectorAll('.menu')) m.classList.toggle('hidden', m.id !== id);
}

function seedFromString(s) {
  s = s.trim();
  if (!s) return Math.floor(Math.random() * 2 ** 31);
  if (/^-?\d+$/.test(s)) return Number(s) | 0;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

async function showTitle() {
  document.body.classList.remove('in-game');
  const meta = await storage.getMeta();
  $('btn-continue').classList.toggle('hidden', !meta);
  $('continue-info').classList.toggle('hidden', !meta);
  if (meta) {
    const when = meta.savedAt ? new Date(meta.savedAt).toLocaleString() : '';
    $('continue-info').textContent = `种子 ${meta.seed} · ${meta.gameMode === 'creative' ? '创造' : '生存'} · ${when}`;
  }
  $('btn-continue').onclick = () => startGame(meta);
  show('menu-title');
}

async function startGame(meta, seed) {
  show('menu-loading');
  $('load-bar').style.width = '0%';
  if (!meta) await storage.clear();
  document.body.classList.add('in-game');
  game = new Game({
    canvas: $('game'),
    storage,
    meta,
    seed,
    settings,
    callbacks: {
      onProgress: (f) => { $('load-bar').style.width = `${Math.round(f * 100)}%`; },
      onReady: () => {
        show(null);
        game.save();
      },
      onPause: () => {
        syncPauseMenu();
        show('menu-pause');
        pauseShownAt = performance.now();
      },
      onDeath: (msg) => {
        $('death-msg').textContent = msg;
        show('menu-death');
      },
    },
  });
  if (!meta) {
    game.gameMode = newMode;
    game.applyGameMode();
  }
  window.webcraft = game; // handy for debugging from the console
  game.start();
}

function syncPauseMenu() {
  const bind = (id, key, fmt = (v) => v) => {
    const input = $(`set-${id}`);
    input.value = settings[key];
    $(`val-${id}`).textContent = fmt(settings[key]);
    input.oninput = () => {
      settings[key] = Number(input.value);
      $(`val-${id}`).textContent = fmt(settings[key]);
      saveSettings();
      game?.applySettings(settings);
    };
  };
  bind('rd', 'renderDistance');
  bind('fov', 'fov');
  bind('sens', 'sensitivity', (v) => Number(v).toFixed(1));
  bind('vol', 'volume', (v) => `${Math.round(v * 100)}%`);
  $('btn-mode').textContent = `游戏模式：${game.gameMode === 'creative' ? '创造' : '生存'}`;
  $('btn-difficulty').textContent = `难度：${game.difficulty === 'peaceful' ? '和平（无敌对生物）' : '普通'}`;
}

function resume() {
  show(null);
  game.paused = false;
  game.lock();
}

// ---------- wiring ----------
$('btn-new').onclick = async () => {
  const meta = await storage.getMeta();
  if (meta && !confirm('创建新世界会覆盖当前存档，确定吗？')) return;
  startGame(null, seedFromString($('seed-input').value));
};
for (const b of document.querySelectorAll('.seg-btn')) {
  b.onclick = () => {
    newMode = b.dataset.mode;
    for (const o of document.querySelectorAll('.seg-btn')) o.classList.toggle('active', o === b);
  };
}
$('btn-help').onclick = () => show('menu-help');
$('btn-help-back').onclick = () => show('menu-title');
$('btn-resume').onclick = resume;
$('btn-mode').onclick = () => {
  game.setGameMode(game.gameMode === 'creative' ? 'survival' : 'creative');
  syncPauseMenu();
};
$('btn-difficulty').onclick = () => {
  game.difficulty = game.difficulty === 'peaceful' ? 'normal' : 'peaceful';
  syncPauseMenu();
};
$('btn-save').onclick = () => game.save(true);
$('btn-quit').onclick = async () => {
  const g = game;
  game = null;
  await g.stop();
  showTitle();
};
$('btn-respawn').onclick = () => {
  show(null);
  game.respawn();
};
let pauseShownAt = 0;
document.addEventListener('keydown', (e) => {
  // Ignore the same Esc press that released the pointer lock.
  if (e.code === 'Escape' && game?.paused && performance.now() - pauseShownAt > 300
    && !$('menu-pause').classList.contains('hidden')) resume();
});
window.addEventListener('pagehide', () => game?.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game?.save();
});

// Classic dirt menu background, generated from the atlas.
const dirt = tileCanvas('dirt');
const big = document.createElement('canvas');
big.width = big.height = 64;
const g = big.getContext('2d');
g.imageSmoothingEnabled = false;
g.drawImage(dirt, 0, 0, 64, 64);
document.documentElement.style.setProperty('--dirt', `url(${big.toDataURL()})`);

storage.open().then(showTitle);
