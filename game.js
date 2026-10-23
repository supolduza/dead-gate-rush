/* Dead Gate Rush - vanilla JS canvas game */
(() => {
'use strict';
const W = 450, H = 800, PY = 690, ROADL = 88, ROADR = 362, MID = (ROADL + ROADR) / 2;
const cv = document.getElementById('game'), ctx = cv.getContext('2d');
const wrap = document.getElementById('wrap'), $ = id => document.getElementById(id);
let scale = 1;
function resize() {
  scale = Math.min(innerWidth / W, innerHeight / H);
  const cw = Math.floor(W * scale), ch = Math.floor(H * scale);
  wrap.style.width = cw + 'px'; wrap.style.height = ch + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.floor(cw * dpr); cv.height = Math.floor(ch * dpr);
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  wrap.style.fontSize = Math.max(11, 16 * scale) + 'px';
}
addEventListener('resize', resize); resize();

/* ---------- utils ---------- */
const rand = (a, b) => a + Math.random() * (b - a), rint = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v, pick = a => a[Math.floor(Math.random() * a.length)];
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.ceil(n));

/* ---------- save ---------- */
const SAVE_KEY = 'dgr_save_v1';
let save = { coins: 0, best: 1, level: 1, up: { dmg: 0, rate: 0, squad: 0 }, muted: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
save.up = Object.assign({ dmg: 0, rate: 0, squad: 0 }, save.up);
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

/* ---------- assets ---------- */
const IMG = {};
['hero', 'ally', 'boss', 'zombie1', 'zombie2', 'zombie3', 'barrel', 'w0', 'w1', 'w2', 'w3', 'w4'].forEach(n => { IMG[n] = new Image(); IMG[n].src = 'assets/' + n + '.png'; });
IMG.road = new Image(); IMG.road.src = 'assets/road.jpg';
const ok = im => im && im.complete && im.naturalWidth > 0;
function sprite(name, x, y, h, flash) {
  const im = IMG[name];
  if (!ok(im)) return false;
  const w = h * im.naturalWidth / im.naturalHeight;
  ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
  if (flash) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = flash; ctx.drawImage(im, x - w / 2, y - h / 2, w, h); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
  return true;
}

/* ---------- audio (WebAudio synth) ---------- */
let actx = null, adMute = false, lastSnd = {};
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); }
function snd(type) {
  if (save.muted || adMute || !actx) return;
  const now = actx.currentTime;
  if (lastSnd[type] && now - lastSnd[type] < ({ shoot: .07, hit: .05 }[type] || .03)) return;
  lastSnd[type] = now;
  const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
  const P = {
    shoot: ['square', 900, 300, .05, .06], hit: ['triangle', 300, 120, .06, .08], kill: ['sawtooth', 220, 50, .2, .12],
    gateGood: ['sine', 500, 1200, .25, .2], gateBad: ['sawtooth', 300, 80, .35, .18], reward: ['square', 600, 1500, .3, .15],
    hurt: ['sawtooth', 160, 40, .25, .2], boss: ['sawtooth', 80, 40, .8, .25], win: ['triangle', 400, 1400, .6, .2], lose: ['sawtooth', 300, 30, .9, .2], click: ['sine', 700, 900, .06, .1]
  }[type];
  if (!P) return;
  o.type = P[0]; o.frequency.setValueAtTime(P[1], now); o.frequency.exponentialRampToValueAtTime(P[2], now + P[3]);
  g.gain.setValueAtTime(P[4], now); g.gain.exponentialRampToValueAtTime(.0001, now + P[3]);
  o.start(now); o.stop(now + P[3] + .02);
}

/* ---------- CrazyGames SDK (guarded) ---------- */
const CG = {
  sdk: null, ready: false, inGameplay: false,
  async init() {
    try {
      for (let i = 0; i < 20 && !(window.CrazyGames && window.CrazyGames.SDK); i++) await new Promise(r => setTimeout(r, 100));
      if (window.CrazyGames && window.CrazyGames.SDK) { await window.CrazyGames.SDK.init(); this.sdk = window.CrazyGames.SDK; this.ready = true; }
    } catch (e) { console.warn('CrazyGames SDK unavailable:', e && e.message); this.sdk = null; }
  },
  call(fn) { try { if (this.ready && this.sdk.game && this.sdk.game[fn]) this.sdk.game[fn](); } catch (e) {} },
  loadingStart() { this.call('loadingStart'); }, loadingStop() { this.call('loadingStop'); },
  gameplayStart() { if (!this.inGameplay) { this.inGameplay = true; this.call('gameplayStart'); } },
  gameplayStop() { if (this.inGameplay) { this.inGameplay = false; this.call('gameplayStop'); } },
  ad(kind) { // resolves true if ad watched (rewarded) / finished
    return new Promise(resolve => {
      if (!this.ready || !this.sdk.ad) { resolve(kind === 'rewarded'); return; } // no SDK: grant reward for local testing
      let done = false; const fin = v => { if (done) return; done = true; adMute = false; resolve(v); };
      try {
        this.sdk.ad.requestAd(kind, { adStarted: () => { adMute = true; }, adFinished: () => fin(true), adError: () => fin(kind !== 'rewarded') });
      } catch (e) { fin(kind !== 'rewarded'); }
    });
  }
};

/* ---------- pools ---------- */
function pool(n, make) { const a = []; for (let i = 0; i < n; i++) { const o = make(); o.on = false; a.push(o); } return a; }
function spawn(p) { for (let i = 0; i < p.length; i++) if (!p[i].on) { p[i].on = true; return p[i]; } return null; }
const bullets = pool(260, () => ({ x: 0, y: 0, dmg: 1, big: false }));
const parts = pool(220, () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, col: '#fff', s: 3 }));
const texts = pool(60, () => ({ x: 0, y: 0, str: '', col: '#fff', life: 0, size: 16, vy: -40 }));
const zombies = pool(70, () => ({ x: 0, y: 0, hp: 1, max: 1, t: 0, flash: 0, sp: 0, wob: 0 }));
const barrels = pool(8, () => ({ x: 0, y: 0, hp: 1, max: 1, flash: 0, rw: null }));
const gates = pool(6, () => ({ y: 0, l: null, r: null, done: false }));

/* ---------- data ---------- */
const WEAPONS = [
  { name: 'PISTOL', dmg: 1.0, int: .2, streams: 1, col: '#ffe680' },
  { name: 'DUAL PISTOLS', dmg: 1.0, int: .24, streams: 2, col: '#ffd24a' },
  { name: 'SMG', dmg: 0.9, int: .10, streams: 1, col: '#ffb84a' },
  { name: 'RIFLE', dmg: 2.4, int: .14, streams: 1, col: '#ff9a3a' },
  { name: 'MINIGUN', dmg: 1.5, int: .05, streams: 2, col: '#ff6a2a' }
];
const ZTYPES = [
  { img: 'zombie1', hp: 2, sp: 40, h: 58, r: 16, dmg: 1, col: '#7fbf4a' },
  { img: 'zombie2', hp: 6, sp: 26, h: 62, r: 18, dmg: 2, col: '#d8c79a' },
  { img: 'zombie3', hp: 2, sp: 75, h: 60, r: 15, dmg: 1, col: '#a04ad0' }
];
const UPG = [
  { id: 'dmg', name: 'Damage', desc: '+15% bullet damage' },
  { id: 'rate', name: 'Fire Rate', desc: '+8% fire speed' },
  { id: 'squad', name: 'Starting Squad', desc: '+1 soldier at start' }
];
const upCost = l => Math.round(40 * Math.pow(1.6, l));
const MAXUP = 10;

/* ---------- state ---------- */
let state = 'menu', level = 1, t = 0, LEN = 70, squad = 1, weapon = 0, rateMul = 1, px = MID, tx = MID;
let fireT = 0, allyT = 0, spawnT = 0, eventT = 0, eventIdx = 0, shake = 0, scroll = 0, levelCoins = 0, boss = null, revived = false, hurtCD = 0, squadPulse = 0, kills = 0;
const dmgMul = () => 1 + .15 * save.up.dmg;
const fireMul = () => (1 + .08 * save.up.rate) * rateMul;
const hpScale = () => (1 + .45 * (level - 1)) * (1 + t / 120);

function resetLevel() {
  [bullets, parts, texts, zombies, barrels, gates].forEach(p => p.forEach(o => o.on = false));
  t = 0; LEN = Math.min(90, 60 + level * 3); squad = 2 + save.up.squad; weapon = Math.min(Math.floor((level - 1) / 3), 1); rateMul = 1;
  px = tx = MID; fireT = allyT = 0; spawnT = 3.5; eventT = 1.2; eventIdx = 0; shake = 0; levelCoins = 0; boss = null; revived = false; hurtCD = 0; kills = 0;
}

/* ---------- formation ---------- */
const MAXDRAWN = 30;
function formation(i) { // offsets for ally i (0-based), hero at 0,0
  const ring = i < 6 ? 1 : i < 18 ? 2 : 3, idx = i < 6 ? i : i < 18 ? i - 6 : i - 18, cnt = ring === 1 ? 6 : ring === 2 ? 12 : 12;
  const a = Math.PI * 2 * idx / cnt + ring * .3, rad = ring * 24;
  return [Math.cos(a) * rad, Math.sin(a) * rad * .55 + 6];
}
const squadHalfW = () => { const n = Math.min(squad - 1, MAXDRAWN); return n <= 0 ? 16 : n < 6 ? 40 : n < 18 ? 64 : 88; };

/* ---------- spawning ---------- */
function makeGateOp(good) {
  const lvl = level;
  if (good) {
    const r = Math.random();
    if (r < .55) return { op: '+', v: rint(2, 4 + lvl * 2), good: true };
    if (r < .9) return { op: 'x', v: rint(2, 3), good: true };
    return { op: '🔥', v: 1, good: true }; // fire rate gate
  }
  const r = Math.random();
  if (r < .6) return { op: '-', v: rint(2, 3 + lvl * 2), good: false };
  return { op: '/', v: 2, good: false };
}
function spawnGates() {
  const g = spawn(gates); if (!g) return;
  g.y = -60; g.done = false;
  const a = makeGateOp(true), b = makeGateOp(Math.random() < .25);
  if (Math.random() < .5) { g.l = a; g.r = b; } else { g.l = b; g.r = a; }
  g.l.hits = g.r.hits = 0;
}
function spawnBarrel(x) {
  const b = spawn(barrels); if (!b) return;
  b.x = x; b.y = -40; b.flash = 0;
  const r = Math.random();
  if (weapon < WEAPONS.length - 1 && r < .45) b.rw = { type: 'weapon', label: WEAPONS[weapon + 1].name, icon: 'w' + (weapon + 1) };
  else if (r < .75) { const n = rint(2, 3 + level); b.rw = { type: 'ally', v: n, label: '+' + n + ' ALLY' }; }
  else b.rw = { type: 'rate', label: 'FIRE RATE +25%' };
  b.max = b.hp = Math.round((b.rw.type === 'weapon' ? 40 + weapon * 35 : 25) * hpScale());
}
function spawnZombie(x, y, ti) {
  const z = spawn(zombies); if (!z) return;
  const T = ZTYPES[ti]; z.t = ti; z.x = x; z.y = y; z.max = z.hp = Math.round(T.hp * hpScale()); z.flash = 0; z.sp = T.sp * rand(.85, 1.15); z.wob = rand(0, 6);
}
function spawnHorde(n) {
  const ti = Math.random() < .2 + level * .03 ? 1 : Math.random() < .3 ? 2 : 0;
  const cx = rand(ROADL + 40, ROADR - 40);
  for (let i = 0; i < n; i++) spawnZombie(clamp(cx + rand(-60, 60), ROADL + 14, ROADR - 14), -30 - rand(0, 90), Math.random() < .7 ? ti : rint(0, 2));
}
function spawnBoss() {
  boss = { x: MID, y: -140, max: Math.round(260 * level * (1 + .25 * level)), hp: 0, flash: 0, drain: 0, enter: true };
  boss.hp = boss.max; snd('boss'); shake = 14; addText(MID, 300, 'BOSS INCOMING!', '#ff3a3a', 34, 2);
}

/* ---------- fx ---------- */
function burst(x, y, col, n, sp) {
  for (let i = 0; i < n; i++) { const p = spawn(parts); if (!p) return; const a = rand(0, 6.28), s = rand(.3, 1) * (sp || 160); p.x = x; p.y = y; p.vx = Math.cos(a) * s; p.vy = Math.sin(a) * s; p.max = p.life = rand(.3, .7); p.col = col; p.s = rand(2, 5); }
}
function addText(x, y, str, col, size, life) { const o = spawn(texts); if (!o) return; o.x = x; o.y = y; o.str = str; o.col = col; o.size = size || 16; o.life = life || .8; o.vy = -50; }

/* ---------- gameplay ---------- */
function fireBullet(x, y, dmg, big) { const b = spawn(bullets); if (!b) return; b.x = x; b.y = y; b.dmg = dmg; b.big = big; }
function changeSquad(n, x, y) {
  const before = squad; squad = clamp(Math.round(n), 0, 999); squadPulse = .3;
  const d = squad - before; if (d) addText(x || px, (y || PY) - 60, (d > 0 ? '+' : '') + d, d > 0 ? '#5fd0ff' : '#ff5a5a', 26, 1);
  if (squad <= 0) gameOver();
}
function applyGate(g) {
  if (g.op === '+') changeSquad(squad + g.v); else if (g.op === '-') changeSquad(squad - g.v);
  else if (g.op === 'x') changeSquad(squad * g.v); else if (g.op === '/') changeSquad(Math.ceil(squad / g.v));
  else if (g.op === '🔥') { rateMul = Math.min(rateMul * 1.25, 3); addText(px, PY - 80, 'FIRE RATE UP!', '#ffb84a', 22, 1); }
  snd(g.good ? 'gateGood' : 'gateBad'); burst(px, PY - 30, g.good ? '#4fb6ff' : '#ff4f5a', 24, 220);
  if (!g.good) shake = 8;
}
function grant(rw, x, y) {
  snd('reward'); burst(x, y, '#ffd84a', 30, 240);
  if (rw.type === 'weapon') { weapon = Math.min(weapon + 1, WEAPONS.length - 1); addText(x, y - 30, WEAPONS[weapon].name + '!', '#ffd84a', 24, 1.3); }
  else if (rw.type === 'ally') changeSquad(squad + rw.v, x, y);
  else { rateMul = Math.min(rateMul * 1.25, 3); addText(x, y - 30, 'FIRE RATE UP!', '#ffb84a', 22, 1.2); }
}
function killZombie(z) {
  z.on = false; kills++; levelCoins += 1; snd('kill');
  burst(z.x, z.y, '#8b0d0d', 10, 150); burst(z.x, z.y, ZTYPES[z.t].col, 6, 120);
  if (kills % 5 === 0) addText(z.x, z.y - 20, '+🪙', '#ffd84a', 16, .7);
}

function update(dt) {
  t += dt; hurtCD -= dt; squadPulse = Math.max(0, squadPulse - dt);
  const spd = boss ? 50 : 130; scroll = (scroll + spd * dt) % H;
  // movement
  const hw = squadHalfW(); tx = clamp(tx, ROADL + Math.min(hw, 60), ROADR - Math.min(hw, 60));
  px += (tx - px) * Math.min(1, dt * 14);
  // spawns
  if (!boss) {
    spawnT -= dt; eventT -= dt;
    if (spawnT <= 0) { spawnHorde(rint(1, 2 + Math.floor(level / 2) + Math.floor(t / 20))); spawnT = rand(1.6, 2.6) / (1 + level * .06); }
    if (eventT <= 0) {
      const e = eventIdx++ % 3;
      if (e === 0) spawnGates(); else if (e === 1) spawnBarrel(Math.random() < .5 ? ROADL + 60 : ROADR - 60); else { spawnBarrel(rand(ROADL + 50, ROADR - 50)); }
      eventT = rand(3.2, 4.2);
    }
    if (t >= LEN) spawnBoss();
  }
  // firing
  const W0 = WEAPONS[weapon], fm = fireMul(), dm = dmgMul();
  fireT -= dt;
  if (fireT <= 0) {
    fireT = W0.int / fm;
    for (let s = 0; s < W0.streams; s++) fireBullet(px + (W0.streams > 1 ? (s ? 7 : -7) : 4), PY - 46, W0.dmg * dm, weapon >= 3);
    snd('shoot');
  }
  const allies = squad - 1;
  if (allies > 0) {
    allyT -= dt;
    if (allyT <= 0) {
      allyT = .28 / fm;
      const shooters = Math.min(allies, 8), per = allies / shooters * .8 * dm * (1 + weapon * .25);
      const n = Math.min(allies, MAXDRAWN);
      for (let s = 0; s < shooters; s++) { const [ox, oy] = formation(Math.floor(s * n / shooters)); fireBullet(px + ox + 4, PY + oy - 30, per, per > 3); }
    }
  }
  // bullets
  for (const b of bullets) {
    if (!b.on) continue;
    b.y -= 950 * dt; if (b.y < -20) { b.on = false; continue; }
    // gates
    for (const g of gates) {
      if (!g.on || g.done || b.y > g.y + 30 || b.y < g.y - 30) continue;
      const side = b.x < MID ? g.l : g.r;
      side.hits += b.dmg; b.on = false;
      const need = 4 + level * 2;
      if (side.hits >= need && (side.op === '+' || side.op === '-')) {
        side.hits -= need;
        if (side.op === '+') side.v++; else { side.v--; if (side.v <= 0) { side.op = '+'; side.v = 1; side.good = true; } }
      }
      break;
    }
    if (!b.on) continue;
    if (boss && Math.abs(b.x - boss.x) < 60 && Math.abs(b.y - boss.y) < 70) {
      boss.hp -= b.dmg; boss.flash = .1; b.on = false; levelCoins += 0;
      if (Math.random() < .3) addText(b.x + rand(-20, 20), boss.y - 40, fmt(b.dmg), '#fff', 14, .5);
      if (boss.hp <= 0) winLevel();
      continue;
    }
    for (const br of barrels) {
      if (!br.on || Math.abs(b.x - br.x) > 26 || Math.abs(b.y - br.y) > 30) continue;
      br.hp -= b.dmg; br.flash = .08; b.on = false; snd('hit');
      if (br.hp <= 0) { br.on = false; grant(br.rw, br.x, br.y); burst(br.x, br.y, '#8a5a2a', 18, 200); }
      break;
    }
    if (!b.on) continue;
    for (const z of zombies) {
      if (!z.on) continue;
      const r = ZTYPES[z.t].r + 4;
      if (Math.abs(b.x - z.x) > r || Math.abs(b.y - z.y) > r + 10) continue;
      z.hp -= b.dmg; z.flash = .08; z.y -= 3; b.on = false; snd('hit');
      burst(b.x, b.y, '#c22', 2, 80);
      if (Math.random() < .25) addText(z.x + rand(-10, 10), z.y - 30, fmt(b.dmg), '#fff', 13, .45);
      if (z.hp <= 0) killZombie(z);
      break;
    }
  }
  // gates
  for (const g of gates) {
    if (!g.on) continue;
    g.y += spd * dt;
    if (!g.done && g.y >= PY - 30) { g.done = true; applyGate(px < MID ? g.l : g.r); }
    if (g.y > H + 60) g.on = false;
  }
  for (const br of barrels) { if (!br.on) continue; br.y += spd * dt; br.flash -= dt; if (br.y > H + 50) br.on = false; }
  // zombies
  for (const z of zombies) {
    if (!z.on) continue;
    z.flash -= dt; z.wob += dt * 8;
    z.y += (z.sp + spd * .55) * dt;
    if (z.y > PY - 250) z.x += clamp(px - z.x, -1, 1) * 40 * dt;
    if (z.y > PY - 40 && z.y < PY + 40 && Math.abs(z.x - px) < hw + 10) {
      z.on = false; burst(z.x, z.y, '#c22', 14, 180); shake = 6; snd('hurt');
      changeSquad(squad - ZTYPES[z.t].dmg, z.x, z.y); if (state !== 'play') return;
    }
    if (z.y > H + 40) z.on = false;
  }
  // boss
  if (boss) {
    boss.flash -= dt;
    if (boss.y < 170) boss.y += 90 * dt; else boss.y += (14 + level * 2) * dt;
    boss.x += (px - boss.x) * .3 * dt;
    if (boss.y > PY - 110) { boss.drain -= dt; if (boss.drain <= 0) { boss.drain = .2; shake = 8; snd('hurt'); changeSquad(squad - Math.max(1, Math.ceil(level / 2))); if (state !== 'play') return; } }
  }
  // fx
  for (const p of parts) { if (!p.on) continue; p.life -= dt; if (p.life <= 0) { p.on = false; continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .92; p.vy *= .92; }
  for (const o of texts) { if (!o.on) continue; o.life -= dt; o.y += o.vy * dt; if (o.life <= 0) o.on = false; }
  shake = Math.max(0, shake - dt * 30);
  updateHUD();
}

/* ---------- render ---------- */
function drawRoad() {
  if (ok(IMG.road)) { const y = scroll; ctx.drawImage(IMG.road, 0, y - H, W, H); ctx.drawImage(IMG.road, 0, y, W, H); ctx.drawImage(IMG.road, 0, y - 2 * H, W, H); }
  else {
    ctx.fillStyle = '#0d1a24'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#3a3d42'; ctx.fillRect(ROADL - 20, 0, ROADR - ROADL + 40, H);
    ctx.fillStyle = '#888'; ctx.fillRect(ROADL - 26, 0, 6, H); ctx.fillRect(ROADR + 20, 0, 6, H);
    ctx.fillStyle = '#ddd'; for (let y = (scroll % 80) - 80; y < H; y += 80) ctx.fillRect(MID - 3, y, 6, 40);
  }
  const g = ctx.createLinearGradient(0, 0, 0, 220); g.addColorStop(0, 'rgba(10,0,20,.55)'); g.addColorStop(1, 'rgba(10,0,20,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, 220);
}
function drawGateSide(x0, x1, y, s) {
  const col = s.good ? '40,140,255' : '255,50,60';
  ctx.fillStyle = `rgba(${col},.32)`; ctx.fillRect(x0, y - 28, x1 - x0, 56);
  ctx.strokeStyle = `rgba(${col},.95)`; ctx.lineWidth = 3; ctx.strokeRect(x0 + 2, y - 26, x1 - x0 - 4, 52);
  ctx.fillStyle = `rgb(${col})`; ctx.fillRect(x0, y - 34, 8, 68); ctx.fillRect(x1 - 8, y - 34, 8, 68);
  const label = s.op === '🔥' ? '🔥 RATE' : (s.op === 'x' ? '×' : s.op === '/' ? '÷' : s.op) + s.v;
  ctx.font = 'bold 30px Arial Black,Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.strokeText(label, (x0 + x1) / 2, y); ctx.fillStyle = '#fff'; ctx.fillText(label, (x0 + x1) / 2, y);
}
function hpBar(x, y, w, frac, col) { ctx.fillStyle = '#000b'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6); ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 4); }
function outlined(str, x, y, size, col) { ctx.font = `bold ${size}px Arial Black,Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(str, x, y); ctx.fillStyle = col; ctx.fillText(str, x, y); }
function drawSoldier(x, y, hero, h) {
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x, y + h * .42, h * .22, h * .08, 0, 0, 7); ctx.fill();
  if (sprite(hero ? 'hero' : 'ally', x, y, h)) return;
  ctx.fillStyle = hero ? '#222' : '#4a5a2a'; ctx.fillRect(x - 8, y - 10, 16, 26);
  ctx.fillStyle = hero ? '#b3261e' : '#3a4a1a'; ctx.beginPath(); ctx.arc(x, y - 14, 8, 0, 7); ctx.fill();
  ctx.fillStyle = '#111'; ctx.fillRect(x + 6, y - 24, 4, 14);
}
function draw() {
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake) * .5, rand(-shake, shake) * .5);
  drawRoad();
  for (const g of gates) if (g.on) { drawGateSide(ROADL - 6, MID - 2, g.y, g.l); drawGateSide(MID + 2, ROADR + 6, g.y, g.r); }
  for (const br of barrels) {
    if (!br.on) continue;
    if (!sprite('barrel', br.x, br.y, 62, br.flash > 0 ? .6 : 0)) { ctx.fillStyle = br.flash > 0 ? '#fff' : '#8a5a2a'; ctx.fillRect(br.x - 22, br.y - 28, 44, 56); ctx.fillStyle = '#555'; ctx.fillRect(br.x - 22, br.y - 14, 44, 5); ctx.fillRect(br.x - 22, br.y + 10, 44, 5); }
    outlined(fmt(br.hp), br.x, br.y + 2, 20, '#fff');
    const ly = br.y - 52;
    if (br.rw.icon && ok(IMG[br.rw.icon])) { ctx.fillStyle = '#000a'; ctx.fillRect(br.x - 40, ly - 22, 80, 34); sprite(br.rw.icon, br.x, ly - 6, 26); outlined(br.rw.label, br.x, ly + 18, 11, '#ffd84a'); }
    else outlined(br.rw.label, br.x, ly, 14, br.rw.type === 'ally' ? '#5fd0ff' : '#ffd84a');
  }
  for (const z of zombies) {
    if (!z.on) continue; const T = ZTYPES[z.t], bob = Math.sin(z.wob) * 2;
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(z.x, z.y + T.h * .42, 14, 5, 0, 0, 7); ctx.fill();
    if (!sprite(T.img, z.x, z.y + bob, T.h, z.flash > 0 ? .7 : 0)) { ctx.fillStyle = z.flash > 0 ? '#fff' : T.col; ctx.beginPath(); ctx.arc(z.x, z.y, T.r, 0, 7); ctx.fill(); }
    if (z.hp < z.max) hpBar(z.x, z.y - T.h / 2 - 8, 30, z.hp / z.max, '#ff3a3a');
  }
  if (boss) {
    if (!sprite('boss', boss.x, boss.y, 170, boss.flash > 0 ? .5 : 0)) { ctx.fillStyle = boss.flash > 0 ? '#fff' : '#5a6a4a'; ctx.beginPath(); ctx.arc(boss.x, boss.y, 60, 0, 7); ctx.fill(); }
  }
  // bullets
  for (const b of bullets) { if (!b.on) continue; ctx.fillStyle = b.big ? '#ff8a2a' : WEAPONS[weapon].col; ctx.fillRect(b.x - (b.big ? 2.5 : 1.5), b.y - 8, b.big ? 5 : 3, 14); }
  // squad
  if (state !== 'menu') {
    const n = Math.min(squad - 1, MAXDRAWN);
    const order = []; for (let i = 0; i < n; i++) order.push(formation(i));
    order.sort((a, b) => a[1] - b[1]);
    for (const [ox, oy] of order) if (oy < 0) drawSoldier(px + ox, PY + oy, false, 44);
    if (squad > 0) drawSoldier(px, PY, true, 70);
    for (const [ox, oy] of order) if (oy >= 0) drawSoldier(px + ox, PY + oy, false, 44);
    const s = 1 + squadPulse * 1.2, ly = PY - 62 - (n >= 6 ? 14 : 0);
    ctx.save(); ctx.translate(px, ly); ctx.scale(s, s);
    ctx.fillStyle = '#1a5fd0'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 16, 0, 7); ctx.fill(); ctx.stroke();
    outlined(fmt(squad), 0, 1, 16, '#fff'); ctx.restore();
  }
  for (const p of parts) { if (!p.on) continue; ctx.globalAlpha = p.life / p.max; ctx.fillStyle = p.col; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
  ctx.globalAlpha = 1;
  for (const o of texts) { if (!o.on) continue; ctx.globalAlpha = clamp(o.life * 2, 0, 1); outlined(o.str, o.x, o.y, o.size, o.col); }
  ctx.globalAlpha = 1;
  if (boss) { // boss bar
    ctx.fillStyle = '#000c'; ctx.fillRect(40, 52, W - 80, 22); ctx.fillStyle = '#c41e1e'; ctx.fillRect(43, 55, (W - 86) * clamp(boss.hp / boss.max, 0, 1), 16);
    outlined('MUTANT BRUTE  ' + fmt(Math.max(0, boss.hp)), W / 2, 63, 13, '#fff');
  }
  if (state === 'play') { // weapon badge
    ctx.fillStyle = '#000a'; ctx.fillRect(8, H - 40, 150, 32); sprite('w' + weapon, 34, H - 24, 22); outlined(WEAPONS[weapon].name, 105, H - 24, 12, '#ffd84a');
  }
  ctx.restore();
}

/* ---------- HUD / UI flow ---------- */
let hudKey = '';
function updateHUD() {
  const k = level + '|' + (save.coins + levelCoins) + '|' + Math.floor(t * 4);
  if (k === hudKey) return; hudKey = k;
  $('hLevel').textContent = level; $('hCoins').textContent = save.coins + levelCoins;
  $('hProg').style.width = (boss ? 100 : clamp(t / LEN * 100, 0, 100)) + '%';
}
const screens = ['startScreen', 'shopScreen', 'pauseScreen', 'overScreen', 'winScreen'];
function show(id) { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); $('hud').classList.toggle('hidden', !(state === 'play' || state === 'pause')); }
function menu() { state = 'menu'; CG.gameplayStop(); $('bestLv').textContent = save.best; $('sCoins').textContent = save.coins; show('startScreen'); }
function startLevel() { audio(); resetLevel(); state = 'play'; show(null); CG.gameplayStart(); }
function gameOver() {
  if (state !== 'play') return;
  state = 'over'; CG.gameplayStop(); snd('lose'); shake = 16;
  $('oLevel').textContent = level; $('oCoins').textContent = levelCoins;
  $('reviveBtn').classList.toggle('hidden', revived);
  setTimeout(() => show('overScreen'), 500);
}
function bankCoins() { save.coins += levelCoins; levelCoins = 0; persist(); }
let winCoins = 0;
function winLevel() {
  if (state !== 'play') return;
  burst(boss.x, boss.y, '#8b0d0d', 60, 300); burst(boss.x, boss.y, '#ffd84a', 40, 260); shake = 20;
  levelCoins += 20 * level + squad; winCoins = levelCoins; boss = null;
  state = 'win'; CG.gameplayStop(); snd('win');
  $('wCoins').textContent = winCoins; $('doubleBtn').classList.remove('hidden'); $('doubleBtn').disabled = false;
  bankCoins(); level++; save.level = level; save.best = Math.max(save.best, level); persist();
  setTimeout(() => show('winScreen'), 700);
}
function renderShop() {
  $('shopCoins').textContent = save.coins; const list = $('shopList'); list.innerHTML = '';
  UPG.forEach(u => {
    const l = save.up[u.id], c = upCost(l), div = document.createElement('div'); div.className = 'shopItem';
    div.innerHTML = `<div>${u.name} <span style="color:#ffd84a">Lv ${l}</span><small>${u.desc}</small></div>`;
    const b = document.createElement('button'); b.textContent = l >= MAXUP ? 'MAX' : '🪙 ' + c; b.disabled = l >= MAXUP || save.coins < c;
    b.onclick = () => { if (save.coins >= c && l < MAXUP) { save.coins -= c; save.up[u.id]++; persist(); snd('reward'); renderShop(); } };
    div.appendChild(b); list.appendChild(div);
  });
}
let shopReturn = 'startScreen';
function openShop(from) { shopReturn = from; renderShop(); show('shopScreen'); }
const click = (id, fn) => $(id).addEventListener('click', e => { audio(); snd('click'); fn(e); });
click('playBtn', () => { level = save.level || 1; startLevel(); });
click('shopBtn', () => openShop('startScreen'));
click('shopBtn2', () => openShop('winScreen'));
click('shopBack', () => { if (shopReturn === 'startScreen') menu(); else show(shopReturn); });
click('pauseBtn', () => { if (state === 'play') { state = 'pause'; CG.gameplayStop(); show('pauseScreen'); } });
click('resumeBtn', () => { state = 'play'; CG.gameplayStart(); show(null); last = performance.now(); });
click('quitBtn', () => { bankCoins(); menu(); });
click('muteBtn', () => { save.muted = !save.muted; persist(); $('muteBtn').textContent = save.muted ? '🔇' : '🔊'; });
click('restartBtn', async () => { bankCoins(); await CG.ad('midgame'); startLevel(); });
click('menuBtn2', () => { bankCoins(); menu(); });
click('reviveBtn', async () => {
  const okAd = await CG.ad('rewarded');
  if (!okAd) return;
  revived = true; squad = Math.max(5, 1 + save.up.squad);
  zombies.forEach(z => z.on = false); if (boss) boss.y = Math.min(boss.y, 200);
  state = 'play'; show(null); CG.gameplayStart(); last = performance.now(); addText(px, PY - 90, 'REVIVED!', '#6f6', 30, 1.5);
});
click('doubleBtn', async () => {
  $('doubleBtn').disabled = true;
  if (await CG.ad('rewarded')) { save.coins += winCoins; persist(); $('wCoins').textContent = winCoins * 2; $('doubleBtn').classList.add('hidden'); snd('reward'); }
  else $('doubleBtn').disabled = false;
});
click('nextBtn', async () => { if (level > 2) await CG.ad('midgame'); startLevel(); });
$('muteBtn').textContent = save.muted ? '🔇' : '🔊';
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') { state = 'pause'; CG.gameplayStop(); show('pauseScreen'); } });

/* ---------- input ---------- */
let drag = null;
const toLocal = e => { const r = cv.getBoundingClientRect(); return (e.clientX - r.left) / r.width * W; };
cv.addEventListener('pointerdown', e => { audio(); drag = { x: toLocal(e), tx }; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (drag) tx = drag.tx + (toLocal(e) - drag.x) * 1.3; });
const endDrag = () => drag = null; cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
const keys = {}; addEventListener('keydown', e => { keys[e.key] = true; if (e.key === 'Escape' || e.key === 'p') $('pauseBtn').click(); }); addEventListener('keyup', e => keys[e.key] = false);

/* ---------- loop ---------- */
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
  if (keys.ArrowLeft || keys.a) tx -= 400 * dt; if (keys.ArrowRight || keys.d) tx += 400 * dt;
  if (state === 'play') update(dt); else if (state === 'menu') scroll = (scroll + 40 * dt) % H;
  else { for (const p of parts) if (p.on) { p.life -= dt; if (p.life <= 0) p.on = false; else { p.x += p.vx * dt; p.y += p.vy * dt; } } shake = Math.max(0, shake - dt * 30); }
  draw();
  requestAnimationFrame(loop);
}
(async () => {
  await CG.init(); CG.loadingStart();
  await Promise.all(Object.values(IMG).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
  CG.loadingStop();
  menu();
})();
// expose for testing
window.__dgr = { get state() { return state; }, get squad() { return squad; }, get level() { return level; }, setT(v) { t = v; } };
requestAnimationFrame(loop);
})();
