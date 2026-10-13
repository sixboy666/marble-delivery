// ============================================================
// main.js — renderer/lighting setup, screen flow, level select,
// settings, pause, results, adaptive resolution and boot.
// ============================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LEVELS, CHAPTERS, starsForTime } from './levels.js';
import { Save } from './storage.js';
import { Sound } from './audio.js';
import { Game } from './gameplay.js';

// ============================================================
// Renderer / scene / camera / lights
// ============================================================
// Primary-pointer detection: phones/tablets are the "touch" tier.
// (pointer:coarse) is more accurate than ontouchstart, which also
// fires on touch-screen laptops with plenty of GPU headroom.
const TOUCH = matchMedia('(pointer: coarse)').matches;

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  // MSAA is one of the most expensive features on mobile tiled GPUs
  // (multiplies per-fragment cost + memory bandwidth). Phones skip it —
  // at 1.6x pixel ratio edges stay clean enough. Desktop keeps AA.
  canvas, antialias:!TOUCH, stencil:false, powerPreference:'high-performance'
});
renderer.shadowMap.enabled = true;
// PCF (not PCFSoft): the shadow map is baked once per level, but the
// filtering runs per fragment every frame — plain PCF is visibly
// identical for this stylized look and cheaper on mobile GPUs.
renderer.shadowMap.type = THREE.PCFShadowMap;
// Static geometry never moves, so the shadow map is baked once per
// level instead of re-rendered every frame. The marble uses a cheap
// blob shadow (see world.js).
renderer.shadowMap.autoUpdate = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16243c);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 220);
camera.position.set(0, 14, 13);

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a3c5c, 1.05);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff4df, 1.7);
sun.position.set(9, 15, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 45;
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;  sun.shadow.camera.bottom = -16;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);

const fillLight = new THREE.DirectionalLight(0x9fc8ff, 0.35);
fillLight.position.set(-7, 6, -8);
scene.add(fillLight);

// cool rim light from behind for silhouette definition
const rimLight = new THREE.DirectionalLight(0xbfd8ff, 0.5);
rimLight.position.set(-6, 9, -10);
scene.add(rimLight);

// Image-based lighting: neutral studio reflections so metals and gloss
// read correctly. Generated lazily — touch devices skip IBL entirely to
// spend their fragment budget on 60fps (see applyQuality).
let envTex = null;
function ensureEnv(){
  if(!envTex){
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    pmrem.dispose();
  }
  return envTex;
}

// soft depth cue — far ground melts into the sky color
scene.fog = new THREE.Fog(0x16243c, 24, 65);

// Re-fit the sun's shadow frustum tightly around each route so the
// shadow map resolves detail instead of empty space.
scene.add(sun.target);
function fitSunShadows(level){
  let minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
  const eat=(x,z)=>{ minX=Math.min(minX,x); maxX=Math.max(maxX,x);
                     minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z); };
  eat(level.start.p[0], level.start.p[2]);
  eat(level.finish.p[0], level.finish.p[2]);
  eat(level.zone.min[0], level.zone.min[1]);
  eat(level.zone.max[0], level.zone.max[1]);
  for(const f of level.floors){
    eat(f.p[0]-f.s[0]/2, f.p[1]-f.s[1]/2);
    eat(f.p[0]+f.s[0]/2, f.p[1]+f.s[1]/2);
  }
  const m = 3;
  const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
  const r=Math.max(maxX-minX, maxZ-minZ)/2 + m;
  sun.position.set(cx+9, 15, cz+7);
  sun.target.position.set(cx, 0, cz);
  sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera;
  sc.left=-r; sc.right=r; sc.top=r; sc.bottom=-r;
  sc.near=4; sc.far=42;
  sc.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;   // re-bake after the frustum moved
}

// ============================================================
// State
// ============================================================
let game = null;
let currentScreen = 'loading';
let lastResult = null;
let needsFrame = true;   // one-shot render flag for 2D-only screens

const $ = id => document.getElementById(id);

// ============================================================
// Screen management
// ============================================================
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>{
    s.classList.toggle('active', s.id===id);
  });
  currentScreen = id;
  needsFrame = true;   // render one frame so the backdrop is fresh
}

function toast(msg){
  const t = $('toast');
  t.innerHTML = `<span class="toast-msg">${msg}</span>`;
  clearTimeout(t._h);
  t._h = setTimeout(()=>t.innerHTML='', 2200);
}

// ============================================================
// Quality + adaptive resolution
// ============================================================
let maxDPR = 2;          // device pixel ratio cap for the current quality
let resScale = 1;        // dynamic scale factor (lowered on slow devices)
let frameEMA = 16.7;     // smoothed frame interval in ms
let lastAdjust = 0;      // cooldown so the scale doesn't oscillate

function applyResolution(){
  renderer.setPixelRatio(Math.max(0.55, maxDPR*resScale));
}

// Keeps a smoothed frame time and nudges the render resolution down
// on weaker GPUs (and back up when there is headroom). Rendering fewer
// pixels is the single most effective smoothness lever on phones.
function tuneResolution(now){
  if(now - lastAdjust < 500) return;
  if(frameEMA > 21 && resScale > 0.5){
    resScale = Math.max(0.5, resScale-0.12);
    applyResolution();
    lastAdjust = now;
  }else if(frameEMA < 15.5 && resScale < 1){
    resScale = Math.min(1, resScale+0.05);
    applyResolution();
    lastAdjust = now;
  }
}

function applyQuality(){
  const q = Save.getSettings().quality;
  if(q==='low'){
    maxDPR = 1;
    sun.shadow.mapSize.set(1024,1024);
  }else if(TOUCH){
    maxDPR = 1.6;
    sun.shadow.mapSize.set(1024,1024);
  }else{
    maxDPR = 2;
    sun.shadow.mapSize.set(2048,2048);
  }

  // fragment-cost tiers: phones run the PBR shader with ONE light and no
  // IBL — that removes 3 light loops + 2 envmap fetches per fragment
  // (roughly half the fragment ALU). A brighter hemisphere keeps the
  // stylized look full; desktop keeps the full 4-light + IBL setup.
  const fullTier = (q!=='low' && !TOUCH);
  fillLight.visible = fullTier;
  rimLight.visible = fullTier;
  hemi.intensity = fullTier ? 1.05 : 1.25;
  const wantEnv = fullTier ? ensureEnv() : null;
  if(scene.environment !== wantEnv){
    scene.environment = wantEnv;
    scene.traverse(o=>{ if(o.material) o.material.needsUpdate = true; });
  }

  if(sun.shadow.map){ sun.shadow.map.dispose(); sun.shadow.map = null; }
  applyResolution();
  renderer.shadowMap.needsUpdate = true;   // re-bake at the new map size
}

function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  needsFrame = true;
  if(game) game.reframe();   // keep the course framed after rotate/resize
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', ()=>setTimeout(resize, 250));
resize();
applyQuality();

// ============================================================
// Level select — chapter sections + stylized route thumbnails
// ============================================================
const THUMB_COLORS = {
  lab:   { bg1:'#182742', bg2:'#2c4a7a', slab:'#2b3a55', floor:'#41598a', edge:'#9fc4ff', wall:'#4c5f80', deco:'#39d0ff' },
  candy: { bg1:'#5c2242', bg2:'#9c3a70', slab:'#8c4a74', floor:'#b76a9a', edge:'#ffc3e2', wall:'#d98ab8', deco:'#ffb0d8' },
  clock: { bg1:'#382a14', bg2:'#6e5228', slab:'#57452a', floor:'#7a6440', edge:'#f0d9a8', wall:'#8a6f42', deco:'#ffcf6b' }
};

function levelThumbnail(level, cv){
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const c = THUMB_COLORS[level.theme] || THUMB_COLORS.lab;

  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,c.bg1); bg.addColorStop(1,c.bg2);
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

  // world bounds (floors ∪ zone ∪ start/finish)
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  const eat=(x,z)=>{ minX=Math.min(minX,x); maxX=Math.max(maxX,x);
                     minZ=Math.min(minZ,z); maxZ=Math.max(maxZ,z); };
  eat(level.start.p[0], level.start.p[2]);
  eat(level.finish.p[0], level.finish.p[2]);
  eat(level.zone.min[0], level.zone.min[1]);
  eat(level.zone.max[0], level.zone.max[1]);
  for(const f of level.floors){
    eat(f.p[0]-f.s[0]/2, f.p[1]-f.s[1]/2);
    eat(f.p[0]+f.s[0]/2, f.p[1]+f.s[1]/2);
  }
  const pad = Math.max(W,H)*0.10;
  const s = Math.min((W-pad*2)/(maxX-minX || 1), (H-pad*2)/(maxZ-minZ || 1));
  const ox = W/2-((minX+maxX)/2)*s, oy = H/2-((minZ+maxZ)/2)*s;
  const X = x=>ox+x*s, Y = z=>oy+z*s;

  function rr(px,py,pw,ph,r){
    r = Math.min(r, pw/2, ph/2);
    ctx.beginPath();
    ctx.moveTo(px+r,py);
    ctx.arcTo(px+pw,py,px+pw,py+ph,r);
    ctx.arcTo(px+pw,py+ph,px,py+ph,r);
    ctx.arcTo(px,py+ph,px,py,r);
    ctx.arcTo(px,py,px+pw,py,r);
    ctx.closePath();
  }

  // build zone: dashed outline
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.setLineDash([4,4]); ctx.lineWidth = 1.2;
  ctx.strokeRect(X(level.zone.min[0]), Y(level.zone.min[1]),
    (level.zone.max[0]-level.zone.min[0])*s, (level.zone.max[1]-level.zone.min[1])*s);
  ctx.setLineDash([]);

  // floors: slab + top
  for(const f of level.floors){
    const [w,d] = f.s;
    ctx.fillStyle = c.slab;
    rr(X(f.p[0]-w/2)-2, Y(f.p[1]-d/2)-2, w*s+4, d*s+4, 7); ctx.fill();
    ctx.fillStyle = c.floor;
    rr(X(f.p[0]-w/2)+3, Y(f.p[1]-d/2)+3, w*s-6, d*s-6, 5); ctx.fill();
    ctx.strokeStyle = c.edge; ctx.lineWidth = 1.4; ctx.stroke();
  }

  // fixed scenery
  ctx.fillStyle = c.wall;
  for(const b of level.fixed || []){
    rr(X(b.p[0]-b.s[0]/2), Y(b.p[2]-b.s[2]/2),
       Math.max(3, b.s[0]*s), Math.max(3, b.s[2]*s), 2);
    ctx.fill();
  }

  // finish ring + flag
  const fx = X(level.finish.p[0]), fy = Y(level.finish.p[2]);
  ctx.strokeStyle = c.deco; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(fx, fy, 5.5, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fx, fy-2); ctx.lineTo(fx, fy-13); ctx.stroke();
  ctx.fillStyle = c.deco;
  ctx.beginPath(); ctx.moveTo(fx, fy-13); ctx.lineTo(fx+8, fy-10.5); ctx.lineTo(fx, fy-8); ctx.closePath(); ctx.fill();

  // chute + eject arrow
  const sx = X(level.start.p[0]), sy = Y(level.start.p[2]);
  ctx.fillStyle = '#ffffff';
  rr(sx-6, sy-6, 12, 12, 3); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx, sy+8); ctx.lineTo(sx, sy-10);
  ctx.lineTo(sx-3.5, sy-5.5); ctx.moveTo(sx, sy-10); ctx.lineTo(sx+3.5, sy-5.5);
  ctx.stroke();

  // level number watermark
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.font = '900 44px Nunito, sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(level.id), W-10, H-12);
}

function buildLevelGrid(){
  const grid = $('level-grid');
  grid.innerHTML = '';
  $('levels-stars').innerHTML = '&#9733; '+Save.totalStars();

  for(const ch of CHAPTERS){
    const head = document.createElement('div');
    head.className = 'chapter-h';
    head.textContent = `CHAPTER ${ch.id} · ${ch.name}`;
    grid.appendChild(head);

    // cards must live inside a .level-grid wrapper — appending them
    // straight into the scroll container breaks the 2-column layout
    const wrap = document.createElement('div');
    wrap.className = 'level-grid';

    for(const id of ch.levels){
      const level = LEVELS.find(l=>l.id===id);
      if(!level) continue;
      const unlocked = Save.isUnlocked(level.id);
      const stars = Save.getStars(level.id);
      const best = Save.getBest(level.id);

      const card = document.createElement('div');
      card.className = 'level-card'+(unlocked?'':' locked');

      const thumb = document.createElement('div');
      thumb.className = 'level-thumb';
      const cv = document.createElement('canvas');
      cv.width = 280; cv.height = 194;
      levelThumbnail(level, cv);
      thumb.appendChild(cv);
      card.appendChild(thumb);

      if(!unlocked){
        const lock = document.createElement('div');
        lock.className = 'level-lock'; lock.innerHTML = '&#128274;';
        card.appendChild(lock);
      }

      const info = document.createElement('div');
      info.className = 'level-info';
      info.innerHTML =
        `<div class="level-name">${level.name}</div>
         <div class="level-meta">
           <span class="level-par">Par ${level.par}s${best!=null ? ' · Best '+best.toFixed(1)+'s' : ''}</span>
           <span class="level-stars">
             ${[1,2,3].map(i=>`<span class="${i<=stars?'got':''}">&#9733;</span>`).join('')}
           </span>
         </div>`;
      card.appendChild(info);

      if(unlocked){
        card.addEventListener('click', ()=>{
          Sound.ui();
          enterLevel(level);
        });
      }
      wrap.appendChild(card);
    }
    grid.appendChild(wrap);
  }
}

// ============================================================
// Settings
// ============================================================
function syncSettingsUI(){
  const s = Save.getSettings();
  $('set-music').checked = s.music;
  $('set-sfx').checked = s.sfx;
  $('set-vibe').checked = s.vibe;
  document.querySelectorAll('#set-quality button').forEach(b=>{
    b.classList.toggle('on', b.dataset.q===s.quality);
  });
}

function bindSettings(){
  $('set-music').addEventListener('change', e=>{
    Save.updateSetting('music', e.target.checked);
    e.target.checked ? Sound.startMusic() : Sound.stopMusic();
  });
  $('set-sfx').addEventListener('change', e=>Save.updateSetting('sfx', e.target.checked));
  $('set-vibe').addEventListener('change', e=>Save.updateSetting('vibe', e.target.checked));
  document.querySelectorAll('#set-quality button').forEach(b=>{
    b.addEventListener('click', ()=>{
      Save.updateSetting('quality', b.dataset.q);
      applyQuality();
      syncSettingsUI();
      Sound.ui();
    });
  });
}

// ============================================================
// Gameplay entry / exit
// ============================================================
function enterLevel(level){
  if(!game){
    game = new Game({renderer, scene, camera, canvas}, {
      onFinish: showResult,
      onLevelStart: fitSunShadows,
      toast
    });
    game.installDebug();
  }
  clearResultTimers();
  showScreen('hud');
  $('hud-best').textContent = Save.getBest(level.id)!=null
    ? Save.getBest(level.id).toFixed(1)+'s' : '–';
  game.setPaused(false);
  game.startLevel(level);
  // pre-compile all shaders up front: the first interactive frame should
  // not pay the one-time GPU program stalls mid-drag
  try{ renderer.compile(scene, camera); }catch(e){}
  // adaptation warm-up: the first frames compile shaders (one-time GPU
  // stalls). Ignore them so the EMA doesn't wrongly drop the resolution.
  frameEMA = 16.7;
  lastAdjust = performance.now() + 800;
}

function exitToLevels(){
  if(game){ game.abortLevel(); game.setPaused(false); }
  clearResultTimers();
  buildLevelGrid();
  showScreen('levels');
}

// ============================================================
// Pause / result
// ============================================================
function pauseGame(){
  if(!game || currentScreen!=='hud') return;
  game.setPaused(true);
  Sound.ui();
  showScreen('pause');
}
function resumeGame(){
  if(game) game.setPaused(false);
  Sound.ui();
  showScreen('hud');
}

// star-pop timers — cancelled if the player leaves the result screen early
let resultTimers = [];
function clearResultTimers(){
  resultTimers.forEach(clearTimeout);
  resultTimers = [];
}

function showResult(res){
  lastResult = res;
  clearResultTimers();
  const level = game.level;
  const stars = starsForTime(res.time, level.par);
  const rec = Save.recordResult(level.id, res.time, stars);

  $('result-title').textContent = 'Delivered!';
  $('r-time').textContent = res.time.toFixed(1)+'s';
  $('r-par').textContent = level.par+'s';
  const bestNow = Save.getBest(level.id);
  $('r-best').textContent = bestNow!=null ? bestNow.toFixed(1)+'s' : '–';

  const recEl = $('result-record');
  if(rec.newBest && rec.prevBest!=null){
    recEl.textContent = 'NEW RECORD!';
    recEl.classList.add('show');
  }else{
    recEl.classList.remove('show');
  }

  // next button
  const next = $('btn-next');
  if(level.id >= LEVELS.length){
    next.textContent = 'All Done!';
    next.disabled = true;
  }else{
    next.innerHTML = 'Next &#8594;';
    next.disabled = false;
  }

  // star pop
  const starEls = document.querySelectorAll('#result-stars .r-star');
  starEls.forEach(s=>s.classList.remove('lit','pop'));
  starEls.forEach((s,i)=>{
    resultTimers.push(setTimeout(()=>{
      if(i < stars){ s.classList.add('lit','pop'); Sound.pop(); }
    }, 350 + i*320));
  });

  showScreen('result');
}

// ============================================================
// Global actions
// ============================================================
document.addEventListener('click', e=>{
  const btn = e.target.closest('[data-action]');
  if(!btn) return;
  const act = btn.dataset.action;

  switch(act){
    case 'play': {
      Sound.ui();
      const id = Math.min(Save.data.unlocked, LEVELS.length);
      const level = LEVELS.find(l=>l.id===id) || LEVELS[0];
      enterLevel(level);
      break;
    }
    case 'levels': Sound.ui(); buildLevelGrid(); showScreen('levels'); break;
    case 'settings': Sound.ui(); syncSettingsUI(); showScreen('settings'); break;
    case 'back-menu': Sound.ui(); showScreen('menu'); break;
    case 'reset-save':
      if(confirm('Reset all progress, records and unlocks? This cannot be undone.')){
        Save.resetAll();
        applyQuality();
        syncSettingsUI();
        buildLevelGrid();
        toast('Progress reset. Fresh start!');
      }
      break;

    // HUD
    case 'pause': pauseGame(); break;
    case 'resume': resumeGame(); break;
    case 'restart':
      if(game){
        game.setPaused(false);
        game.resetLevel();
        showScreen('hud');
      }
      break;
    case 'launch': if(game) game.launch(); break;
    case 'edit': if(game){ game.toBuild(); Sound.ui(); } break;
    case 'rot': if(game) game.rotateSelected(); break;
    case 'del': if(game) game.removeSelected(); break;
    case 'desel': if(game) game.deselect(); break;
    case 'to-levels': exitToLevels(); break;

    // result
    case 'replay':
      Sound.ui();
      if(game){
        game.setPaused(false);
        game.resetLevel();
        showScreen('hud');
      }
      break;
    case 'next': {
      if(!game) break;
      const nextLevel = LEVELS.find(l=>l.id===game.level.id+1);
      if(nextLevel){ Sound.ui(); enterLevel(nextLevel); }
      break;
    }
  }
});

// ============================================================
// Audio init on first gesture + music
// ============================================================
function firstGesture(){
  try{
    Sound.init();
    if(Save.getSettings().music) Sound.startMusic();
  }catch(err){ /* audio may be blocked */ }
  window.removeEventListener('pointerdown', firstGesture);
}
window.addEventListener('pointerdown', firstGesture);

// ============================================================
// Desktop convenience: keyboard shortcuts + no context menu
// ============================================================
window.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    if(currentScreen==='hud') pauseGame();
    else if(currentScreen==='pause') resumeGame();
  }else if((e.key==='r' || e.key==='R') && currentScreen==='hud' && game){
    game.resetLevel();
  }
});
window.addEventListener('contextmenu', e=>{
  if(e.target === canvas) e.preventDefault();
});

// ============================================================
// Main loop
// ============================================================
// Screens whose UI fully covers the canvas don't need continuous
// rendering — a single frame on switch keeps the backdrop correct
// and saves a lot of battery in menus.
const FLAT_SCREENS = new Set(['loading','menu','levels','settings','pause','result']);

let lastT = performance.now();
function loop(now){
  const rawMs = now - lastT;
  lastT = now;
  const dt = Math.min(0.05, rawMs/1000);

  if(currentScreen==='hud' && game) game.update(dt);

  if(FLAT_SCREENS.has(currentScreen)){
    if(needsFrame){ renderer.render(scene, camera); needsFrame = false; }
  }else{
    renderer.render(scene, camera);
  }

  // adaptive resolution — only measured while actually playing
  if(currentScreen==='hud'){
    frameEMA = frameEMA*0.92 + Math.min(rawMs,100)*0.08;
    tuneResolution(now);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ============================================================
// Boot: fonts + loading progress, then menu
// ============================================================
bindSettings();
syncSettingsUI();

const fill = $('loading-fill');
let prog = 0;
const loadInt = setInterval(()=>{
  prog = Math.min(95, prog+8+Math.random()*14);
  fill.style.width = prog+'%';
}, 90);

Promise.race([
  document.fonts ? document.fonts.ready : Promise.resolve(),
  new Promise(r=>setTimeout(r, 1600))
]).then(()=>new Promise(r=>setTimeout(r, 300))).then(()=>{
  clearInterval(loadInt);
  fill.style.width = '100%';
  setTimeout(()=>{ showScreen('menu'); }, 400);
});
