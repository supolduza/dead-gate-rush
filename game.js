/* Dead Gate Rush 3D - Three.js (vendored), no build step */
import * as THREE from './vendor/three.min.js';
import { mergeGeometries } from './vendor/three.min.js';

const $ = id => document.getElementById(id);
const DEBUG = /[?&]debug/.test(location.search);
const rand = (a, b) => a + Math.random() * (b - a), rint = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(Math.max(0, Math.ceil(n)));
const HW = 4, SPAWNZ = -70;

/* ---------------- save ---------------- */
const SAVE_KEY = 'dgr_save_v1';
let save = { coins: 0, best: 1, level: 1, up: { dmg: 0, rate: 0, squad: 0 }, muted: false };
try { Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) {}
save.up = Object.assign({ dmg: 0, rate: 0, squad: 0 }, save.up);
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

/* ---------------- audio ---------------- */
let actx = null, adMute = false; const lastSnd = {};
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state !== 'running') actx.resume().catch(() => {}); }
['touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (actx && actx.state !== 'running') actx.resume().catch(() => {}); }));
const SND = {
  shoot: ['square', 900, 300, .05, .05], hit: ['triangle', 300, 120, .06, .07], kill: ['sawtooth', 220, 50, .2, .1],
  gateGood: ['sine', 500, 1200, .25, .2], gateBad: ['sawtooth', 300, 80, .35, .18], reward: ['square', 600, 1500, .3, .14],
  hurt: ['sawtooth', 160, 40, .25, .2], boss: ['sawtooth', 80, 40, .8, .25], spit: ['triangle', 500, 150, .25, .12],
  charge: ['sawtooth', 60, 200, .6, .2], win: ['triangle', 400, 1400, .6, .2], lose: ['sawtooth', 300, 30, .9, .2], click: ['sine', 700, 900, .06, .1]
};
function snd(type) {
  if (save.muted || adMute || !actx || actx.state !== 'running') return;
  const now = actx.currentTime; if (lastSnd[type] && now - lastSnd[type] < ({ shoot: .07, hit: .05 }[type] || .03)) return; lastSnd[type] = now;
  const P = SND[type]; if (!P) return;
  const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
  o.type = P[0]; o.frequency.setValueAtTime(P[1], now); o.frequency.exponentialRampToValueAtTime(P[2], now + P[3]);
  g.gain.setValueAtTime(P[4], now); g.gain.exponentialRampToValueAtTime(.0001, now + P[3]); o.start(now); o.stop(now + P[3] + .02);
}

/* ---------------- CrazyGames SDK (guarded, with timeouts) ---------------- */
const timeout = (p, ms, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), ms))]);
const CG = {
  sdk: null, ready: false, inGameplay: false,
  async init() {
    try {
      for (let i = 0; i < 15 && !(window.CrazyGames && window.CrazyGames.SDK); i++) await new Promise(r => setTimeout(r, 100));
      const S = window.CrazyGames && window.CrazyGames.SDK; if (!S) return;
      await timeout(Promise.resolve(S.init()), 4000, null);
      // Only use the SDK when actually running on CrazyGames; elsewhere (GitHub Pages, localhost) use fallbacks.
      if (S.environment === 'crazygames') { this.sdk = S; this.ready = true; }
    } catch (e) { console.warn('CrazyGames SDK unavailable'); }
  },
  call(fn) { try { if (this.ready && this.sdk.game && this.sdk.game[fn]) this.sdk.game[fn](); } catch (e) {} },
  loadingStart() { this.call('loadingStart'); }, loadingStop() { this.call('loadingStop'); },
  gameplayStart() { if (!this.inGameplay) { this.inGameplay = true; this.call('gameplayStart'); } },
  gameplayStop() { if (this.inGameplay) { this.inGameplay = false; this.call('gameplayStop'); } },
  ad(kind) { // resolves true = finished/rewarded. Never hangs.
    if (!this.ready || !this.sdk.ad) return Promise.resolve(kind === 'rewarded');
    let started = false;
    const p = new Promise(resolve => {
      let done = false; const fin = v => { if (done) return; done = true; adMute = false; resolve(v); };
      try {
        this.sdk.ad.requestAd(kind, { adStarted: () => { started = true; adMute = true; }, adFinished: () => fin(true), adError: () => fin(kind !== 'rewarded') });
      } catch (e) { fin(kind !== 'rewarded'); }
      setTimeout(() => { if (!started) fin(kind !== 'rewarded'); }, 6000);   // no ad started in 6s -> continue
      setTimeout(() => fin(kind !== 'rewarded'), 90000);                     // absolute safety net
    });
    return p;
  }
};

/* ---------------- renderer / scene ---------------- */
const host = $('wrap');
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2f48);
scene.fog = new THREE.Fog(0x2a2f48, 35, 85);
const camera = new THREE.PerspectiveCamera(58, 9 / 16, 0.1, 120);
scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x4a3a30, 2.2));
const sun = new THREE.DirectionalLight(0xffd0a0, 2.2); sun.position.set(-4, 10, 6); scene.add(sun);
const fx = $('fx'), fctx = fx.getContext('2d');
let VW = 1, VH = 1, FS = 1;
function resize() {
  // portrait 9:16 area, letterboxed
  const s = Math.min(innerWidth / 9, innerHeight / 16);
  VW = Math.floor(9 * s); VH = Math.floor(16 * s);
  host.style.width = VW + 'px'; host.style.height = VH + 'px';
  renderer.setSize(VW, VH, false); camera.aspect = VW / VH; camera.updateProjectionMatrix();
  const d = Math.min(window.devicePixelRatio || 1, 2); fx.width = VW * d; fx.height = VH * d; fctx.setTransform(d, 0, 0, d, 0, 0);
  FS = VW / 450; host.style.fontSize = Math.max(11, 16 * FS) + 'px';
}
addEventListener('resize', resize); resize();

/* ---------------- geometry helpers ---------------- */
function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); g.deleteAttribute('uv');
  return g;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), S = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
const C = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const vmat = new THREE.MeshLambertMaterial({ vertexColors: true });

/* humanoid: faces -z. opts: colors & extras. legs optional so hero can animate them */
function humanoid(o) {
  const p = [];
  if (o.legs !== false) { p.push(part(B(.2, .8, .22), o.pants, -.13, .4, 0), part(B(.2, .8, .22), o.pants, .13, .4, 0)); p.push(part(B(.22, .14, .32), o.boots, -.13, .07, -.04), part(B(.22, .14, .32), o.boots, .13, .07, -.04)); }
  p.push(part(B(.5, .62, .3), o.shirt, 0, 1.12, 0));
  if (o.vest) p.push(part(B(.54, .42, .34), o.vest, 0, 1.17, 0));
  p.push(part(C(.07, .07, .16), o.skin, 0, 1.5, 0));
  p.push(part(S(.17, 10, 8), o.skin, 0, 1.66, 0));
  if (o.arms === 'forward') { // zombie arms reaching forward
    p.push(part(B(.13, .13, .6), o.armCol || o.shirt, -.31, 1.3, -.28), part(B(.13, .13, .6), o.armCol || o.shirt, .31, 1.3, -.28));
    p.push(part(S(.08), o.skin, -.31, 1.3, -.6), part(S(.08), o.skin, .31, 1.3, -.6));
  } else { // holding gun
    p.push(part(B(.13, .5, .14), o.shirt, -.3, 1.15, -.1, -.6), part(B(.13, .5, .14), o.shirt, .3, 1.2, -.18, -1.2));
    p.push(part(B(.07, .1, .55), 0x15161a, .22, 1.32, -.48));
  }
  (o.extra || []).forEach(e => p.push(e));
  return mergeGeometries(p);
}
const HERO_GEO = humanoid({
  legs: false, pants: 0x1b1c22, boots: 0x111111, shirt: 0x24252c, vest: 0x15161b, skin: 0xe3b48f,
  extra: [part(S(.19, 10, 8), 0xb3261e, 0, 1.72, .03), part(C(.06, .12, .55, 6), 0xb3261e, 0, 1.45, .2, .35), part(S(.08), 0xb3261e, 0, 1.7, .2), part(B(.52, .06, .32), 0x3a2b22, 0, .86, 0)]
});
const LEG_GEO = mergeGeometries([part(B(.18, .8, .2), 0x1b1c22, 0, -.4, 0), part(B(.2, .14, .3), 0x111111, 0, -.78, -.04)]);
const ALLY_GEO = humanoid({ pants: 0x4b5530, boots: 0x2b2418, shirt: 0x5a6538, vest: 0x3d4426, skin: 0xc79a74, extra: [part(S(.2, 10, 6), 0x4b5530, 0, 1.72, 0)] });
const ZOMBIE_GEO = [
  humanoid({ arms: 'forward', pants: 0x3b3326, boots: 0x6f8f4a, shirt: 0xb5ad96, skin: 0x7fb04a, extra: [part(B(.08, .06, .02), 0xff3a1a, -.07, 1.7, -.16), part(B(.08, .06, .02), 0xff3a1a, .07, 1.7, -.16)] }),
  humanoid({ arms: 'forward', pants: 0xcdbb8e, boots: 0xbfae80, shirt: 0xd8c79a, skin: 0xcbb78a, armCol: 0xd2c194, extra: [part(B(.36, .05, .36), 0xa8966a, 0, 1.6, 0), part(B(.36, .05, .36), 0xa8966a, 0, 1.0, 0), part(B(.08, .05, .02), 0xffd02a, -.07, 1.68, -.17), part(B(.08, .05, .02), 0xffd02a, .07, 1.68, -.17)] }),
  humanoid({ arms: 'forward', pants: 0x15121a, boots: 0x0b0b0b, shirt: 0x2a1530, skin: 0xd8d4e6, armCol: 0x3a1a40, extra: [part(B(.8, 1.1, .06), 0x5a0f22, 0, 1.0, .2), part(C(.0, .32, .3, 6), 0x5a0f22, 0, 1.45, .12), part(S(.19, 8, 6), 0x111111, 0, 1.75, .03), part(B(.08, .05, .02), 0xff1a1a, -.07, 1.68, -.17), part(B(.08, .05, .02), 0xff1a1a, .07, 1.68, -.17)] })
];
ZOMBIE_GEO.forEach(g => g.rotateY(Math.PI)); // face the player (+z)
const BOSS_GEO = (() => {
  const sk = 0x6f7d5a, dk = 0x3a3330;
  const g = mergeGeometries([
    part(B(.38, .9, .4), dk, -.3, .45, 0), part(B(.38, .9, .4), dk, .3, .45, 0),
    part(B(1.3, 1.0, .8), sk, 0, 1.45, 0), part(B(1.1, .5, .7), sk, 0, .95, 0), part(B(1.0, .45, .6), dk, 0, .8, 0),
    part(S(.45, 10, 8), sk, -.75, 1.85, 0), part(S(.45, 10, 8), sk, .75, 1.85, 0),
    part(B(.34, 1.1, .34), sk, -.95, 1.15, -.1, -.3), part(B(.34, 1.1, .34), sk, .95, 1.15, -.1, -.3),
    part(S(.3), sk, -.98, .55, -.35), part(S(.3), sk, .98, .55, -.35),
    part(S(.33, 10, 8), sk, 0, 2.15, -.2), part(B(.3, .1, .1), 0x2a0a0a, 0, 2.0, -.5),
    part(B(.09, .07, .03), 0xff2020, -.12, 2.24, -.5), part(B(.09, .07, .03), 0xff2020, .12, 2.24, -.5),
    part(S(.12), 0x8b1a1a, .4, 1.6, -.41), part(S(.1), 0x8b1a1a, -.3, 1.2, -.41)
  ]);
  g.rotateY(Math.PI); return g;
})();

/* ---------------- textures ---------------- */
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const roadTex = canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#3b3d42'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2500; i++) { const v = rint(40, 80); g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.strokeStyle = '#25262a'; g.lineWidth = 2; for (let i = 0; i < 14; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += rand(-20, 20); y += rand(-25, 25); g.lineTo(x, y); } g.stroke(); }
  g.fillStyle = '#e8e4d0'; g.fillRect(w / 2 - 4, 0, 8, h * .45);
  g.fillStyle = '#c9b347'; g.fillRect(10, 0, 6, h); g.fillRect(w - 16, 0, 6, h);
});
roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping; roadTex.repeat.set(1, 10);
const glowTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
const loader = new THREE.TextureLoader();
const WICON = [0, 1, 2, 3, 4].map(i => { const t = loader.load('assets/w' + i + '.png', undefined, undefined, () => {}); t.colorSpace = THREE.SRGBColorSpace; return t; });

/* ---------------- world ---------------- */
const road = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + .6, 100), new THREE.MeshLambertMaterial({ map: roadTex }));
road.rotation.x = -Math.PI / 2; road.position.z = -40; scene.add(road);
const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x0d2030 })); water.rotation.x = -Math.PI / 2; water.position.set(0, -3, -40); scene.add(water);
const railMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
[-1, 1].forEach(s => { const r = new THREE.Mesh(B(.12, .12, 100), railMat); r.position.set(s * (HW + .35), .9, -40); scene.add(r); const r2 = r.clone(); r2.position.y = .5; scene.add(r2); const curb = new THREE.Mesh(B(.5, .3, 100), new THREE.MeshLambertMaterial({ color: 0x55585e })); curb.position.set(s * (HW + .4), .15, -40); scene.add(curb); });
const POSTS = 2 * 26, posts = new THREE.InstancedMesh(B(.15, 1.1, .15), railMat, POSTS); scene.add(posts);
const LAMPS = 10, lamps = new THREE.InstancedMesh(mergeGeometries([part(C(.06, .08, 4.5, 6), 0x444850, 0, 2.25, 0), part(B(1.1, .08, .12), 0x444850, -.5, 4.45, 0), part(B(.35, .1, .25), 0xfff1b0, -1, 4.4, 0)]), vmat, LAMPS); scene.add(lamps);
const BLD = 24, blds = new THREE.InstancedMesh(B(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), BLD); scene.add(blds);
const bldData = []; for (let i = 0; i < BLD; i++) { const s = i % 2 ? 1 : -1; bldData.push({ x: s * rand(16, 30), z: -i * 4.5, w: rand(4, 8), h: rand(6, 22), d: rand(4, 8) }); blds.setColorAt(i, new THREE.Color().setHSL(.62, .15, rand(.12, .25))); }
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();
function setInst(mesh, i, x, y, z, ry = 0, s = 1, rz = 0, sx, sy, sz) { tmpE.set(0, ry, rz); tmpQ.setFromEuler(tmpE); tmpV.set(x, y, z); tmpS.set(sx || s, sy || s, sz || s); tmpM.compose(tmpV, tmpQ, tmpS); mesh.setMatrixAt(i, tmpM); }
let envZ = 0;
function updateEnv(dz) {
  envZ += dz; roadTex.offset.y += dz / 10;
  for (let i = 0; i < POSTS / 2; i++) { const z = ((i * 4 + envZ) % 104) - 100 + 4; setInst(posts, i * 2, -(HW + .35), .55, z); setInst(posts, i * 2 + 1, HW + .35, .55, z); }
  posts.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < LAMPS; i++) { const z = ((i * 12 + envZ) % 120) - 108, s = i % 2 ? 1 : -1; setInst(lamps, i, s * (HW + .5), 0, z, s > 0 ? 0 : Math.PI); }
  lamps.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < BLD; i++) { const b = bldData[i]; const z = ((b.z + envZ * .6) % 108 + 108) % 108 - 100; setInst(blds, i, b.x, b.h / 2 - 3, z, 0, 1, 0, b.w, b.h, b.d); }
  blds.instanceMatrix.needsUpdate = true;
}

/* ---------------- entity meshes ---------------- */
const hero = new THREE.Group(); hero.scale.setScalar(1.15); scene.add(hero);
const heroBody = new THREE.Mesh(HERO_GEO, vmat); hero.add(heroBody);
const legL = new THREE.Mesh(LEG_GEO, vmat), legR = new THREE.Mesh(LEG_GEO, vmat); legL.position.set(-.13, .85, 0); legR.position.set(.13, .85, 0); hero.add(legL, legR);
const flashMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffc060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const muzzle = new THREE.Sprite(flashMat); muzzle.scale.set(.7, .7, .7); muzzle.position.set(.22, 1.32, -.85); hero.add(muzzle);
const heroShadow = new THREE.Mesh(new THREE.CircleGeometry(.4, 12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .35, depthWrite: false })); heroShadow.rotation.x = -Math.PI / 2; heroShadow.position.y = .02; hero.add(heroShadow);
const MAXALLY = 40, allyMesh = new THREE.InstancedMesh(ALLY_GEO, vmat, MAXALLY); allyMesh.count = 0; scene.add(allyMesh);
const ZCAP = 45, zMesh = ZOMBIE_GEO.map(g => { const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }), ZCAP); m.count = 0; m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ZCAP * 3).fill(1), 3); scene.add(m); return m; });
const BCAP = 320, bulletMesh = new THREE.InstancedMesh(B(.07, .07, .7), new THREE.MeshBasicMaterial({ color: 0xffe070 }), BCAP); bulletMesh.count = 0; scene.add(bulletMesh);
const SPCAP = 24, spitMesh = new THREE.InstancedMesh(S(.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9dff3a }), SPCAP); spitMesh.count = 0; scene.add(spitMesh);
const bossMesh = new THREE.Mesh(BOSS_GEO, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 })); bossMesh.visible = false; bossMesh.scale.setScalar(2.4); scene.add(bossMesh);
// particles
const PCAP = 400, pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(PCAP * 3), pCol = new Float32Array(PCAP * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: .28, vertexColors: true, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
pts.frustumCulled = false; scene.add(pts);
// barrels
const BARCAP = 8, barrelGeo = mergeGeometries([part(C(.55, .55, 1.2, 14), 0x8a5a2a, 0, .6, 0), part(C(.58, .58, .1, 14), 0x4a4a50, 0, .25, 0), part(C(.58, .58, .1, 14), 0x4a4a50, 0, .95, 0), part(C(.5, .5, .04, 14), 0x6a4420, 0, 1.21, 0)]);
const barrelPool = []; for (let i = 0; i < BARCAP; i++) { const g = new THREE.Group(); const m = new THREE.Mesh(barrelGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0 })); g.add(m); const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: WICON[1], depthWrite: false })); icon.position.y = 2.1; icon.scale.set(1.3, .6, 1); g.add(icon); g.visible = false; scene.add(g); barrelPool.push({ on: false, g, m, icon, x: 0, z: 0, hp: 1, max: 1, flash: 0, rw: null }); }
// gates
function gateTex() { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, t }; }
function paintGate(side) {
  const g = side.tex.c.getContext('2d'), col = side.good ? [40, 150, 255] : [255, 50, 60];
  g.clearRect(0, 0, 256, 128);
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, `rgba(${col},.55)`); gr.addColorStop(1, `rgba(${col},.25)`); g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = `rgba(${col},1)`; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
  const label = side.op === 'R' ? '🔥RATE' : (side.op === 'x' ? '×' : side.op === '/' ? '÷' : side.op) + side.v;
  g.font = 'bold 72px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 8; g.strokeStyle = '#000'; g.strokeText(label, 128, 68); g.fillStyle = '#fff'; g.fillText(label, 128, 68);
  side.tex.t.needsUpdate = true; side.mat.color.set(0xffffff); side.post.color.set(side.good ? 0x3aa0ff : 0xff3a4a);
}
const gatePool = []; for (let i = 0; i < 4; i++) {
  const grp = new THREE.Group(); const sides = [];
  for (let s = 0; s < 2; s++) {
    const tex = gateTex(), mat = new THREE.MeshBasicMaterial({ map: tex.t, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(HW - .1, 2.2), mat); panel.position.set((s ? 1 : -1) * HW / 2, 1.4, 0); grp.add(panel);
    const post = new THREE.MeshBasicMaterial({ color: 0x3aa0ff });
    [-1, 1].forEach(e => { const p = new THREE.Mesh(B(.16, 2.8, .16), post); p.position.set((s ? 1 : -1) * HW / 2 + e * (HW / 2 - .05), 1.4, 0); grp.add(p); });
    const top = new THREE.Mesh(B(HW - .1, .14, .16), post); top.position.set((s ? 1 : -1) * HW / 2, 2.8, 0); grp.add(top);
    sides.push({ tex, mat, post, op: '+', v: 1, good: true, hits: 0 });
  }
  grp.visible = false; scene.add(grp); gatePool.push({ on: false, grp, l: sides[0], r: sides[1], z: 0, done: false });
}

/* ---------------- data ---------------- */
const WEAPONS = [
  { name: 'PISTOL', dmg: 1.0, int: .2, streams: 1, col: 0xffe680 },
  { name: 'DUAL PISTOLS', dmg: 1.0, int: .18, streams: 2, col: 0xffd24a },
  { name: 'SMG', dmg: .9, int: .09, streams: 1, col: 0xffb84a },
  { name: 'RIFLE', dmg: 2.4, int: .13, streams: 1, col: 0xff9a3a },
  { name: 'MINIGUN', dmg: 1.5, int: .05, streams: 2, col: 0xff6a2a }
];
const ZTYPES = [{ hp: 2, sp: 3, r: .45, dmg: 1, col: [.5, .75, .3] }, { hp: 6, sp: 1.8, r: .5, dmg: 2, col: [.85, .78, .6] }, { hp: 2, sp: 5.5, r: .42, dmg: 1, col: [.6, .3, .8] }];
const UPG = [{ id: 'dmg', name: 'Damage', desc: '+15% bullet damage' }, { id: 'rate', name: 'Fire Rate', desc: '+8% fire speed' }, { id: 'squad', name: 'Starting Squad', desc: '+1 soldier at start' }];
const upCost = l => Math.round(40 * Math.pow(1.6, l)), MAXUP = 10, REVIVE_COST = 50;

/* ---------------- pools (logic) ---------------- */
const mkPool = (n, f) => Array.from({ length: n }, () => Object.assign(f(), { on: false }));
const spawn = p => { for (const o of p) if (!o.on) { o.on = true; return o; } return null; };
const bullets = mkPool(BCAP, () => ({ x: 0, y: 0, z: 0, dmg: 1 }));
const zombies = mkPool(ZCAP * 3 - 15, () => ({ x: 0, z: 0, t: 0, hp: 1, max: 1, flash: 0, sp: 0, wob: 0 }));
const spits = mkPool(SPCAP, () => ({ x: 0, y: 0, z: 0, vx: 0, vz: 0 }));
const parts = mkPool(PCAP, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 1, g: 1, b: 1 }));
const texts = mkPool(50, () => ({ x: 0, y: 0, z: 0, str: '', col: '#fff', life: 0, size: 16, vy: 1.2 }));

/* ---------------- state ---------------- */
let state = 'menu', level = 1, t = 0, LEN = 70, squad = 1, weapon = 0, rateMul = 1, px = 0, tx = 0;
let fireT = 0, allyT = 0, spawnT = 0, eventT = 0, eventIdx = 0, shake = 0, levelCoins = 0, boss = null, revived = false, squadPulse = 0, kills = 0, muzzleT = 0, bossTime = 0, walk = 0;
const dmgMul = () => 1 + .15 * save.up.dmg, fireMul = () => (1 + .08 * save.up.rate) * rateMul;
const hpScale = () => (1 + .6 * (level - 1)) * (1 + t / 90);
const squadHalfW = () => { const n = Math.min(squad - 1, MAXALLY); return n <= 0 ? .45 : n < 6 ? .9 : n < 18 ? 1.4 : 2; };
function formation(i) { const ring = i < 6 ? 1 : i < 18 ? 2 : 3, idx = i < 6 ? i : i < 18 ? i - 6 : i - 18, cnt = ring === 1 ? 6 : ring === 2 ? 12 : 22; const a = Math.PI * 2 * idx / cnt + ring * .3; return [Math.cos(a) * ring * .62, Math.abs(Math.sin(a)) * ring * .5 + ring * .35]; }
function estDps() { const W = WEAPONS[weapon], fm = fireMul(), dm = dmgMul(); const allies = squad - 1; return W.dmg * dm * W.streams * fm / W.int + (allies > 0 ? allies * .8 * dm * (1 + weapon * .25) * fm / .28 : 0); }

function resetLevel() {
  [bullets, zombies, spits, parts, texts, barrelPool, gatePool].forEach(p => p.forEach(o => o.on = false));
  barrelPool.forEach(b => b.g.visible = false); gatePool.forEach(g => g.grp.visible = false);
  t = 0; LEN = Math.min(90, 60 + level * 3); squad = 2 + save.up.squad; weapon = Math.min(Math.floor((level - 1) / 3), 1); rateMul = 1;
  px = tx = 0; fireT = allyT = 0; spawnT = 3; eventT = 1.2; eventIdx = 0; shake = 0; levelCoins = 0; boss = null; bossMesh.visible = false; revived = false; kills = 0; bossTime = 0;
}

/* ---------------- spawning ---------------- */
function gateOp(good) {
  if (good) { const r = Math.random(); if (r < .55) return { op: '+', v: rint(2, 4 + level * 2), good: true }; if (r < .9) return { op: 'x', v: rint(2, 3), good: true }; return { op: 'R', v: 1, good: true }; }
  return Math.random() < .6 ? { op: '-', v: rint(2 + level, 4 + level * 3), good: false } : { op: '/', v: level > 4 ? 3 : 2, good: false };
}
function spawnGates() {
  const g = spawn(gatePool); if (!g) return; g.z = SPAWNZ; g.done = false; g.grp.visible = true;
  const a = gateOp(true), b = gateOp(Math.random() < Math.max(.05, .3 - level * .04)); const [L, R] = Math.random() < .5 ? [a, b] : [b, a];
  Object.assign(g.l, L, { hits: 0 }); Object.assign(g.r, R, { hits: 0 }); paintGate(g.l); paintGate(g.r);
}
function spawnBarrel(x) {
  const b = spawn(barrelPool); if (!b) return; b.x = x; b.z = SPAWNZ; b.flash = 0; b.g.visible = true;
  const r = Math.random();
  if (weapon < WEAPONS.length - 1 && r < .45) b.rw = { type: 'weapon', label: WEAPONS[weapon + 1].name, icon: weapon + 1 };
  else if (r < .75) { const n = rint(2, 3 + level); b.rw = { type: 'ally', v: n, label: '+' + n + ' ALLY' }; }
  else b.rw = { type: 'rate', label: 'FIRE RATE +25%' };
  b.icon.visible = b.rw.type === 'weapon'; if (b.icon.visible) b.icon.material.map = WICON[b.rw.icon];
  b.max = b.hp = Math.round((b.rw.type === 'weapon' ? 40 + weapon * 40 : 25) * hpScale());
}
function spawnZombie(x, z, ti) { const o = spawn(zombies); if (!o) return; const T = ZTYPES[ti]; Object.assign(o, { t: ti, x, z, flash: 0, sp: T.sp * rand(.85, 1.15), wob: rand(0, 6) }); o.max = o.hp = Math.round(T.hp * hpScale()); }
function spawnHorde(n, cx, cz) {
  const ti = Math.random() < .2 + level * .04 ? 1 : Math.random() < .3 + level * .02 ? 2 : 0;
  cx = cx === undefined ? rand(-HW + 1, HW - 1) : cx;
  for (let i = 0; i < n; i++) spawnZombie(clamp(cx + rand(-1.8, 1.8), -HW + .4, HW - .4), (cz || SPAWNZ) - rand(0, 4), Math.random() < .7 ? ti : rint(0, 2));
}
function spawnBoss() {
  const hp = Math.round(Math.max(300 * level * (1 + .3 * level), estDps() * (10 + 2.5 * level)));
  boss = { x: 0, z: SPAWNZ, hp, max: hp, flash: 0, phase: 1, mode: 'enter', mt: 0, spitT: 2, chargeT: 6, summonT: 8, drain: 0, cx: 0 };
  bossMesh.visible = true; snd('boss'); shake = .5; addText(0, 3, -8, 'BOSS INCOMING!', '#ff3a3a', 34, 2);
}

/* ---------------- fx ---------------- */
function burst(x, y, z, col, n, sp = 4) { const c = tmpC.set(col); for (let i = 0; i < n; i++) { const p = spawn(parts); if (!p) return; const a = rand(0, 6.28), e = rand(-.3, 1.2), s = rand(.3, 1) * sp; Object.assign(p, { x, y, z, vx: Math.cos(a) * s, vy: e * s, vz: Math.sin(a) * s, max: rand(.3, .7), r: c.r, g: c.g, b: c.b }); p.life = p.max; } }
function addText(x, y, z, str, col, size = 16, life = .8) { const o = spawn(texts); if (!o) return; Object.assign(o, { x, y, z, str, col, size, life, vy: 1.4 }); }
function fire(x, y, z, dmg) { const b = spawn(bullets); if (!b) return; b.x = x; b.y = y; b.z = z; b.dmg = dmg; }

/* ---------------- gameplay ---------------- */
function changeSquad(n, x, z) {
  const before = squad; squad = clamp(Math.round(n), 0, 999); squadPulse = .3;
  const d = squad - before; if (d) addText(x ?? px, 2.6, z ?? 0, (d > 0 ? '+' : '') + d, d > 0 ? '#5fd0ff' : '#ff5a5a', 26, 1);
  if (squad <= 0) gameOver();
}
function applyGate(g) {
  if (g.op === '+') changeSquad(squad + g.v); else if (g.op === '-') changeSquad(squad - g.v);
  else if (g.op === 'x') changeSquad(squad * g.v); else if (g.op === '/') changeSquad(Math.ceil(squad / g.v));
  else { rateMul = Math.min(rateMul * 1.25, 3); addText(px, 3, 0, 'FIRE RATE UP!', '#ffb84a', 22, 1); }
  snd(g.good ? 'gateGood' : 'gateBad'); burst(px, 1.2, 0, g.good ? 0x4fb6ff : 0xff4f5a, 30, 6); if (!g.good) shake = .35;
}
function grant(rw, x, z) {
  snd('reward'); burst(x, 1, z, 0xffd84a, 30, 6);
  if (rw.type === 'weapon') { weapon = Math.min(weapon + 1, WEAPONS.length - 1); addText(x, 2.5, z, WEAPONS[weapon].name + '!', '#ffd84a', 24, 1.3); bulletMesh.material.color.set(WEAPONS[weapon].col); }
  else if (rw.type === 'ally') changeSquad(squad + rw.v, x, z);
  else { rateMul = Math.min(rateMul * 1.25, 3); addText(x, 2.5, z, 'FIRE RATE UP!', '#ffb84a', 22, 1.2); }
}
function killZombie(z) { z.on = false; kills++; levelCoins++; snd('kill'); burst(z.x, 1, z.z, 0x8b0d0d, 8, 4); burst(z.x, 1.2, z.z, 0x77cc44, 4, 3); }

function update(dt) {
  t += dt; squadPulse = Math.max(0, squadPulse - dt); muzzleT -= dt;
  const spd = boss ? 2 : 8; updateEnv(spd * dt); walk += dt * (boss ? 6 : 11);
  const hw = squadHalfW(); tx = clamp(tx, -HW + Math.min(hw, 1.6), HW - Math.min(hw, 1.6)); px += (tx - px) * Math.min(1, dt * 14);
  if (!boss) {
    spawnT -= dt; eventT -= dt;
    if (spawnT <= 0) { spawnHorde(rint(1 + Math.floor(level / 2), 2 + level + Math.floor(t / 18))); spawnT = rand(1.6, 2.6) / (1 + level * .12); }
    if (eventT <= 0) { const e = eventIdx++ % 3; if (e === 0) spawnGates(); else spawnBarrel(e === 1 ? (Math.random() < .5 ? -2 : 2) : rand(-2.8, 2.8)); eventT = rand(3.2, 4.2); }
    if (t >= LEN) spawnBoss();
  }
  // firing
  const W = WEAPONS[weapon], fm = fireMul(), dm = dmgMul();
  if ((fireT -= dt) <= 0) { fireT = W.int / fm; for (let s = 0; s < W.streams; s++) fire(px + (W.streams > 1 ? (s ? .18 : -.12) : .22), 1.32, -.9, W.dmg * dm); muzzleT = .05; snd('shoot'); }
  const allies = squad - 1;
  if (allies > 0 && (allyT -= dt) <= 0) {
    allyT = .28 / fm; const shooters = Math.min(allies, 10), per = allies / shooters * .8 * dm * (1 + weapon * .25), n = Math.min(allies, MAXALLY);
    for (let s = 0; s < shooters; s++) { const [ox, oz] = formation(Math.floor(s * n / shooters)); fire(px + ox + .22, 1.3, oz - .8, per); }
  }
  // bullets
  const BS = 55 * dt;
  for (const b of bullets) {
    if (!b.on) continue; b.z -= BS; if (b.z < SPAWNZ - 5) { b.on = false; continue; }
    for (const g of gatePool) {
      if (!g.on || g.done || b.z > g.z + .6 || b.z < g.z - .6) continue;
      const side = b.x < 0 ? g.l : g.r; side.hits += b.dmg; b.on = false; const need = 4 + level * 3;
      if (side.hits >= need && (side.op === '+' || side.op === '-')) { side.hits -= need; if (side.op === '+') side.v++; else { side.v--; if (side.v <= 0) { side.op = '+'; side.v = 1; side.good = true; } } paintGate(side); }
      break;
    }
    if (!b.on) continue;
    if (boss && Math.abs(b.x - boss.x) < 1.8 && Math.abs(b.z - boss.z) < 1.2) {
      boss.hp -= b.dmg; boss.flash = .08; b.on = false; if (Math.random() < .2) addText(b.x, 4.5, boss.z, fmt(b.dmg), '#fff', 14, .5);
      if (boss.phase === 1 && boss.hp < boss.max * .66) bossPhase(2); else if (boss.phase === 2 && boss.hp < boss.max * .33) bossPhase(3);
      if (boss.hp <= 0) { winLevel(); return; } continue;
    }
    for (const br of barrelPool) { if (!br.on || Math.abs(b.x - br.x) > .65 || Math.abs(b.z - br.z) > .6) continue; br.hp -= b.dmg; br.flash = .08; b.on = false; snd('hit'); if (br.hp <= 0) { br.on = false; br.g.visible = false; grant(br.rw, br.x, br.z); burst(br.x, .8, br.z, 0x8a5a2a, 20, 5); } break; }
    if (!b.on) continue;
    for (const z of zombies) {
      if (!z.on) continue; const r = ZTYPES[z.t].r; if (Math.abs(b.x - z.x) > r || Math.abs(b.z - z.z) > r + .3) continue;
      z.hp -= b.dmg; z.flash = .08; z.z -= .08; b.on = false; snd('hit'); burst(b.x, 1.2, z.z, 0xcc2222, 2, 2);
      if (Math.random() < .25) addText(z.x, 2.2, z.z, fmt(b.dmg), '#fff', 13, .45);
      if (z.hp <= 0) killZombie(z); break;
    }
  }
  for (const g of gatePool) { if (!g.on) continue; g.z += spd * dt; if (!g.done && g.z >= -.2) { g.done = true; applyGate(px < 0 ? g.l : g.r); if (state !== 'play') return; } if (g.z > 8) { g.on = false; g.grp.visible = false; } }
  for (const br of barrelPool) { if (!br.on) continue; br.z += spd * dt; br.flash -= dt; if (br.z > 8) { br.on = false; br.g.visible = false; } }
  for (const z of zombies) {
    if (!z.on) continue; z.flash -= dt; z.wob += dt * 8; z.z += (z.sp + spd * .55) * dt;
    if (z.z > -18) z.x += clamp(px - z.x, -1, 1) * 2.2 * dt;
    if (z.z > -.9 && z.z < 1 && Math.abs(z.x - px) < hw + .3) { z.on = false; burst(z.x, 1, z.z, 0xcc2222, 14, 5); shake = .25; snd('hurt'); changeSquad(squad - ZTYPES[z.t].dmg * (level > 3 ? 2 : 1), z.x, z.z); if (state !== 'play') return; }
    if (z.z > 6) z.on = false;
  }
  if (boss) { updateBoss(dt, hw); if (state !== 'play') return; }
  for (const s of spits) {
    if (!s.on) continue; s.x += s.vx * dt; s.z += s.vz * dt; s.y = Math.max(.5, s.y - dt * .8);
    if (s.z > -.6 && s.z < .8 && Math.abs(s.x - px) < hw + .3) { s.on = false; burst(s.x, 1, s.z, 0x9dff3a, 20, 5); shake = .4; snd('hurt'); changeSquad(squad - Math.max(1 + Math.floor(level / 2), Math.ceil(squad * .08))); if (state !== 'play') return; }
    if (s.z > 6) s.on = false;
  }
  for (const p of parts) { if (!p.on) continue; p.life -= dt; if (p.life <= 0) { p.on = false; continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 9 * dt; }
  for (const o of texts) { if (!o.on) continue; o.life -= dt; o.y += o.vy * dt; if (o.life <= 0) o.on = false; }
  shake = Math.max(0, shake - dt * 1.5); updateHUD();
}
function bossPhase(p) {
  boss.phase = p; shake = .6; snd('boss'); addText(boss.x, 5, boss.z, p === 2 ? 'ENRAGED!' : 'BERSERK!', '#ff3a3a', 30, 1.6);
  spawnHorde(6 + level * 2, boss.x, boss.z + 2); burst(boss.x, 2, boss.z, 0xff3a3a, 40, 8);
}
function updateBoss(dt, hw) {
  bossTime += dt; boss.flash -= dt; boss.mt += dt;
  const ph = boss.phase, rage = 1 + (ph - 1) * .45;
  if (boss.mode === 'enter') { boss.z += 10 * dt; if (boss.z >= -24) { boss.mode = 'fight'; boss.mt = 0; } }
  else if (boss.mode === 'fight') {
    boss.z = Math.min(boss.z + (.25 + level * .05) * rage * dt, -3); boss.x += clamp(px - boss.x, -1, 1) * 1.2 * dt;
    if ((boss.spitT -= dt) <= 0) {
      boss.spitT = Math.max(1, 2.6 - level * .12) / rage; snd('spit');
      const shots = ph === 3 ? 3 : ph === 2 ? 2 : 1;
      for (let k = 0; k < shots; k++) { const s = spawn(spits); if (!s) break; const tgt = px + (k - (shots - 1) / 2) * 1.4, T = -boss.z / 14; Object.assign(s, { x: boss.x, y: 3.5, z: boss.z + 1, vz: 14, vx: (tgt - boss.x) / T }); }
    }
    if (ph >= 2 && (boss.chargeT -= dt) <= 0) { boss.mode = 'tele'; boss.mt = 0; boss.cx = px; addText(boss.x, 5.5, boss.z, '⚠ CHARGE!', '#ffb000', 28, 1); snd('charge'); }
    if (ph >= 3 && (boss.summonT -= dt) <= 0) { boss.summonT = 6; spawnHorde(4 + level, boss.x, boss.z + 2); }
  } else if (boss.mode === 'tele') { boss.flash = .05; if (boss.mt > .9) { boss.mode = 'charge'; boss.mt = 0; } }
  else if (boss.mode === 'charge') {
    boss.z += 26 * dt; boss.x += clamp(boss.cx - boss.x, -1, 1) * 8 * dt;
    if (boss.z > -1.2) {
      if (Math.abs(boss.x - px) < hw + 1.4) { shake = 1; snd('hurt'); burst(px, 1, 0, 0xcc2222, 40, 8); changeSquad(squad - Math.max(5 + level, Math.ceil(squad * .3))); if (state !== 'play') return; }
      boss.mode = 'back'; boss.mt = 0;
    }
  } else if (boss.mode === 'back') { boss.z -= 14 * dt; if (boss.z <= -22) { boss.mode = 'fight'; boss.chargeT = rand(5, 8) / rage; } }
  if (boss.mode === 'fight' && boss.z > -3.5 && (boss.drain -= dt) <= 0) { boss.drain = .25; shake = .3; snd('hurt'); changeSquad(squad - Math.max(1, level)); }
}

/* ---------------- render ---------------- */
const proj = new THREE.Vector3();
function toScreen(x, y, z) { proj.set(x, y, z).project(camera); return proj.z < 1 ? [(proj.x + 1) / 2 * VW, (1 - proj.y) / 2 * VH] : null; }
function txt(str, x, y, size, col) { fctx.font = `bold ${size * FS}px Arial Black, Arial`; fctx.textAlign = 'center'; fctx.textBaseline = 'middle'; fctx.lineWidth = 4 * FS; fctx.strokeStyle = '#000'; fctx.strokeText(str, x, y); fctx.fillStyle = col; fctx.fillText(str, x, y); }
function bar(x, y, w, f, col) { fctx.fillStyle = '#000b'; fctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6); fctx.fillStyle = col; fctx.fillRect(x - w / 2, y, w * clamp(f, 0, 1), 4); }
function render() {
  const sh = shake * shake;
  camera.position.set(px * .5 + rand(-sh, sh), 7.8 + rand(-sh, sh), 9.8); camera.lookAt(px * .4, 0, -13);
  // hero
  hero.visible = state !== 'menu' && squad > 0; hero.position.set(px, 0, 0);
  const sw = Math.sin(walk) * .5; legL.rotation.x = sw; legR.rotation.x = -sw; heroBody.position.y = Math.abs(Math.cos(walk)) * .05; muzzle.visible = muzzleT > 0;
  // allies
  const n = state === 'menu' ? 0 : Math.min(squad - 1, MAXALLY); allyMesh.count = n;
  for (let i = 0; i < n; i++) { const [ox, oz] = formation(i); setInst(allyMesh, i, px + ox, Math.abs(Math.sin(walk + i)) * .06, oz, 0, .72); }
  allyMesh.instanceMatrix.needsUpdate = true;
  // zombies
  const cnt = [0, 0, 0];
  for (const z of zombies) {
    if (!z.on) continue; const m = zMesh[z.t], i = cnt[z.t]++; if (i >= ZCAP) continue;
    setInst(m, i, z.x, Math.abs(Math.sin(z.wob)) * .08, z.z, 0, z.t === 1 ? 1.05 : 1, Math.sin(z.wob) * .08);
    const f = z.flash > 0 ? 3 : 1; m.instanceColor.setXYZ(i, f, f, f);
  }
  zMesh.forEach((m, k) => { m.count = Math.min(cnt[k], ZCAP); m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; });
  // bullets / spit
  let bi = 0; for (const b of bullets) if (b.on) setInst(bulletMesh, bi++, b.x, b.y, b.z); bulletMesh.count = bi; bulletMesh.instanceMatrix.needsUpdate = true;
  let si = 0; for (const s of spits) if (s.on) setInst(spitMesh, si++, s.x, s.y, s.z, 0, 1 + Math.sin(t * 20) * .15); spitMesh.count = si; spitMesh.instanceMatrix.needsUpdate = true;
  // boss
  if (boss) { bossMesh.position.set(boss.x, Math.abs(Math.sin(t * 4)) * .1, boss.z); bossMesh.rotation.z = Math.sin(t * 4) * .04; bossMesh.material.emissive.setHex(boss.flash > 0 ? (boss.mode === 'tele' ? 0xaa2000 : 0x555555) : 0); }
  for (const br of barrelPool) if (br.on) { br.g.position.set(br.x, 0, br.z); br.m.material.emissive.setHex(br.flash > 0 ? 0x555555 : 0); }
  for (const g of gatePool) if (g.on) g.grp.position.z = g.z;
  // particles
  for (let i = 0; i < PCAP; i++) { const p = parts[i]; if (p.on) { pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z; const a = p.life / p.max; pCol[i * 3] = p.r * a; pCol[i * 3 + 1] = p.g * a; pCol[i * 3 + 2] = p.b * a; } else pPos[i * 3 + 1] = -50; }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  renderer.render(scene, camera);
  // 2D overlay
  fctx.clearRect(0, 0, VW, VH);
  if (state === 'menu') return;
  for (const z of zombies) { if (!z.on || z.hp >= z.max) continue; const s = toScreen(z.x, 2.05, z.z); if (s) bar(s[0], s[1], 28 * FS, z.hp / z.max, '#ff3a3a'); }
  for (const br of barrelPool) {
    if (!br.on) continue; const s = toScreen(br.x, .7, br.z); if (s) txt(fmt(br.hp), s[0], s[1], 18, '#fff');
    const l = toScreen(br.x, br.rw.type === 'weapon' ? 1.6 : 1.9, br.z); if (l) txt(br.rw.label, l[0], l[1], 12, br.rw.type === 'ally' ? '#5fd0ff' : '#ffd84a');
  }
  if (squad > 0) { const s = toScreen(px, 2.5 + (squad > 7 ? .4 : 0), 0); if (s) { const r = (16 + squadPulse * 20) * FS; fctx.fillStyle = '#1a5fd0'; fctx.strokeStyle = '#fff'; fctx.lineWidth = 2; fctx.beginPath(); fctx.arc(s[0], s[1], r, 0, 7); fctx.fill(); fctx.stroke(); txt(fmt(squad), s[0], s[1] + 1, 15 + squadPulse * 15, '#fff'); } }
  for (const o of texts) { if (!o.on) continue; const s = toScreen(o.x, o.y, o.z); if (!s) continue; fctx.globalAlpha = clamp(o.life * 2, 0, 1); txt(o.str, s[0], s[1], o.size, o.col); }
  fctx.globalAlpha = 1;
  if (boss) { const w = VW - 80 * FS, y = 52 * FS; fctx.fillStyle = '#000c'; fctx.fillRect(40 * FS, y, w, 22 * FS); fctx.fillStyle = boss.phase === 3 ? '#ff2a00' : '#c41e1e'; fctx.fillRect(43 * FS, y + 3 * FS, (w - 6 * FS) * clamp(boss.hp / boss.max, 0, 1), 16 * FS); txt('MUTANT BRUTE ' + ['', 'I', 'II', 'III'][boss.phase] + '  ' + fmt(boss.hp), VW / 2, y + 11 * FS, 12, '#fff'); }
  if (state === 'play') { fctx.fillStyle = '#000a'; fctx.fillRect(8 * FS, VH - 40 * FS, 150 * FS, 32 * FS); txt(WEAPONS[weapon].name, 83 * FS, VH - 24 * FS, 12, '#ffd84a'); }
}

/* ---------------- UI flow ---------------- */
let hudKey = '';
function updateHUD() { const k = level + '|' + (save.coins + levelCoins) + '|' + Math.floor(t * 4); if (k === hudKey) return; hudKey = k; $('hLevel').textContent = level; $('hCoins').textContent = save.coins + levelCoins; $('hProg').style.width = (boss ? 100 : clamp(t / LEN * 100, 0, 100)) + '%'; }
const screens = ['startScreen', 'shopScreen', 'pauseScreen', 'overScreen', 'winScreen'];
function show(id) { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); $('hud').classList.toggle('hidden', !(state === 'play' || state === 'pause')); }
function menu() { state = 'menu'; CG.gameplayStop(); $('bestLv').textContent = save.best; $('sCoins').textContent = save.coins; show('startScreen'); }
function startLevel() { audio(); resetLevel(); bulletMesh.material.color.set(WEAPONS[weapon].col); state = 'play'; show(null); CG.gameplayStart(); last = performance.now(); }
function gameOver() {
  if (state !== 'play') return; state = 'over'; CG.gameplayStop(); snd('lose'); shake = .8;
  $('oLevel').textContent = level; $('oCoins').textContent = levelCoins;
  $('reviveBtn').classList.toggle('hidden', revived); $('reviveCoinBtn').classList.toggle('hidden', revived); $('reviveCoinBtn').textContent = 'REVIVE (🪙 ' + REVIVE_COST + ')';
  setTimeout(() => { if (state === 'over') show('overScreen'); }, 500);
}
function bankCoins() { save.coins += levelCoins; levelCoins = 0; persist(); }
let winCoins = 0;
function winLevel() {
  if (state !== 'play') return;
  burst(boss.x, 2, boss.z, 0x8b0d0d, 80, 9); burst(boss.x, 2, boss.z, 0xffd84a, 60, 8); shake = 1;
  console.log('[dgr] boss defeated level', level, 'bossTime', bossTime.toFixed(1), 's');
  levelCoins += 25 * level + squad; winCoins = levelCoins; boss = null; bossMesh.visible = false; spits.forEach(s => s.on = false);
  state = 'win'; CG.gameplayStop(); snd('win'); $('wCoins').textContent = winCoins; $('doubleBtn').classList.remove('hidden');
  bankCoins(); level++; save.level = level; save.best = Math.max(save.best, level); persist();
  setTimeout(() => { if (state === 'win') show('winScreen'); }, 700);
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
let shopReturn = 'startScreen', adBusy = false;
function openShop(from) { shopReturn = from; renderShop(); show('shopScreen'); }
function adNotice(msg) { const n = $('adNote'); n.textContent = msg; n.classList.remove('hidden'); setTimeout(() => n.classList.add('hidden'), 2500); }
async function withAdLock(fn) { adBusy = true; const bs = document.querySelectorAll('.overlay button'); bs.forEach(b => b.disabled = true); try { return await fn(); } finally { bs.forEach(b => b.disabled = false); adBusy = false; } }
function doRevive() {
  revived = true; squad = Math.max(5, 2 + save.up.squad); zombies.forEach(z => z.on = false); spits.forEach(s => s.on = false);
  if (boss) { boss.z = Math.min(boss.z, -22); boss.mode = 'fight'; boss.chargeT = 6; }
  state = 'play'; show(null); CG.gameplayStart(); last = performance.now(); addText(px, 3, 0, 'REVIVED!', '#6f6', 30, 1.5);
}
const click = (id, fn) => $(id).addEventListener('click', e => { if (adBusy) return; audio(); snd('click'); fn(e); });
click('playBtn', () => { level = save.level || 1; startLevel(); });
click('shopBtn', () => openShop('startScreen')); click('shopBtn2', () => openShop('winScreen'));
click('shopBack', () => { if (shopReturn === 'startScreen') menu(); else show(shopReturn); });
click('pauseBtn', () => { if (state === 'play') { state = 'pause'; CG.gameplayStop(); show('pauseScreen'); } });
click('resumeBtn', () => { state = 'play'; CG.gameplayStart(); show(null); last = performance.now(); });
click('quitBtn', () => { bankCoins(); menu(); });
click('muteBtn', () => { save.muted = !save.muted; persist(); $('muteBtn').textContent = save.muted ? '🔇' : '🔊'; });
click('restartBtn', () => { bankCoins(); startLevel(); });
click('menuBtn2', () => { bankCoins(); menu(); });
click('reviveBtn', async () => { const okAd = await withAdLock(() => CG.ad('rewarded')); if (okAd) doRevive(); else { $('reviveBtn').classList.add('hidden'); adNotice('No ad available right now - try again later.'); } });
click('reviveCoinBtn', () => { if (save.coins < REVIVE_COST) { adNotice('Not enough coins.'); return; } save.coins -= REVIVE_COST; persist(); doRevive(); });
click('doubleBtn', async () => { const okAd = await withAdLock(() => CG.ad('rewarded')); $('doubleBtn').classList.add('hidden'); if (okAd) { save.coins += winCoins; persist(); $('wCoins').textContent = winCoins * 2; snd('reward'); } else adNotice('No ad available right now - try again later.'); });
click('nextBtn', async () => { if (level > 2) await withAdLock(() => CG.ad('midgame')); startLevel(); });
$('muteBtn').textContent = save.muted ? '🔇' : '🔊';
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') { state = 'pause'; CG.gameplayStop(); show('pauseScreen'); } });

/* ---------------- input ---------------- */
let drag = null; const cv = $('fx');
const lx = e => { const r = cv.getBoundingClientRect(); return (e.clientX - r.left) / r.width; };
cv.addEventListener('pointerdown', e => { audio(); drag = { x: lx(e), tx }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
cv.addEventListener('pointermove', e => { if (drag) tx = drag.tx + (lx(e) - drag.x) * 11; });
const endDrag = () => drag = null; cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
const keys = {}; addEventListener('keydown', e => { keys[e.key] = true; if (e.key === 'Escape' || e.key === 'p') $('pauseBtn').click(); }); addEventListener('keyup', e => keys[e.key] = false);

/* ---------------- loop ---------------- */
let last = performance.now();
let fpsAvg = 60;
function loop(now) {
  fpsAvg = fpsAvg * .95 + (1000 / Math.max(1, now - last)) * .05;
  const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
  if (keys.ArrowLeft || keys.a) tx -= 9 * dt; if (keys.ArrowRight || keys.d) tx += 9 * dt;
  if (state === 'play') update(dt);
  else { if (state === 'menu') { updateEnv(3 * dt); walk += dt * 4; } for (const p of parts) if (p.on && (p.life -= dt) <= 0) p.on = false; shake = Math.max(0, shake - dt * 1.5); }
  render(); requestAnimationFrame(loop);
}
updateEnv(0);
scene.traverse(o => { if (o.isInstancedMesh || o.isPoints) o.frustumCulled = false; });
if (DEBUG) window.__dgr = { get state() { return state; }, get squad() { return squad; }, get level() { return level; }, get bossTime() { return bossTime; }, get boss() { return boss && { hp: boss.hp, max: boss.max, phase: boss.phase, mode: boss.mode }; }, setT(v) { t = v; }, setSquad(v) { squad = v; }, setWeapon(v) { weapon = v; }, kill() { changeSquad(0); }, get fps() { return fpsAvg; } };
(async () => { await CG.init(); CG.loadingStart(); CG.loadingStop(); menu(); })();
requestAnimationFrame(loop);
