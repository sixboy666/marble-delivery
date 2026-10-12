// ============================================================
// gameplay.js — Game orchestration: build phase (dock drag,
// place / rotate / remove modules), fixed-step simulation,
// slow-motion stunts, finish & fail flow, HUD sync.
// ============================================================

import * as THREE from 'three';
import { PhysicsWorld, BALL_R } from './physics.js';
import { World } from './world.js';
import { CamRig } from './camera.js';
import { MODULES } from './modules.js';
import { Sound, vibrate } from './audio.js';

const FIXED_DT = 1/120;
const SNAP = 0.5;

const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _pt = new THREE.Vector3();
const _startVel = new THREE.Vector3();

export class Game{
  constructor({renderer, scene, camera, canvas}, hooks={}){
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.hooks = hooks;

    this.world = new World(scene);
    this.phys = new PhysicsWorld();
    this.rig = new CamRig(camera);

    this.paused = false;
    this.level = null;
    this.phase = 'build';        // build | rolling | done
    this.placements = [];
    this.nextUid = 1;
    this.levelTime = 0;
    this.launchT = 0;

    // slow-mo
    this.ts = 1; this.tsTarget = 1; this.tsTimer = 0;

    // sim accumulator
    this.acc = 0;
    this.clock = 0;

    // input state
    this._drag = null;           // {kind:'new',type}|{kind:'move',uid,offX,offZ,moved}
    this._pid = null;
    this._ghost = this.world.makeGhost();
    this._sel = null;            // selected uid

    this._finishTimer = null;

    this.$ = id => document.getElementById(id);
    this._bindInput();
  }

  // ----------------------------------------------------------
  // level lifecycle
  // ----------------------------------------------------------
  startLevel(level){
    if(this._finishTimer){ clearTimeout(this._finishTimer); this._finishTimer = null; }
    this.level = level;
    this.placements = [];
    this.nextUid = 1;
    this.levelTime = 0;
    this.clock = 0;
    this.acc = 0;
    this.ts = 1; this.tsTarget = 1; this.tsTimer = 0;
    this._select(null);

    this.world.load(level);
    this.phys.compile(level, this.placements);
    this._placeBallAtChute();

    this.rig.frameLevel(level);
    this.hooks.onLevelStart && this.hooks.onLevelStart(level);

    this.$('hud-level').textContent = `${level.id} · ${level.name}`;
    this.$('hud-par').textContent = level.par+'s';
    this.$('hud-timer').textContent = '0.0s';
    this.$('hud-hint').textContent = level.hint;
    this._buildDock();
    this._setPhase('build');
  }

  _placeBallAtChute(){
    const s = this.level.start;
    _pt.set(s.p[0], s.p[1], s.p[2]);
    this.phys.setBall(_pt, _startVel.set(0,0,0));
    this.world.syncBall(_pt, true);
    this.world.resetBallTrail(_pt);
  }

  resetLevel(){
    if(!this.level) return;
    Sound.tap();
    if(this._finishTimer){ clearTimeout(this._finishTimer); this._finishTimer = null; }
    // keep placements — restart means "try the run again"
    this.phys.compile(this.level, this.placements);
    this._placeBallAtChute();
    this.levelTime = 0;
    this.acc = 0;
    this.ts = 1; this.tsTarget = 1; this.tsTimer = 0;
    this._select(null);
    this._setPhase('build');
    this.rig.frameLevel(this.level);
  }

  setPaused(p){
    this.paused = p;
  }

  reframe(){
    if(this.level && this.rig.mode !== 'follow') this.rig.frameLevel(this.level);
  }

  abortLevel(){
    if(this._finishTimer){ clearTimeout(this._finishTimer); this._finishTimer = null; }
  }

  destroy(){
    this.abortLevel();
    this.world.dispose();
    if(this._ghost) this.scene.remove(this._ghost);
  }

  // ----------------------------------------------------------
  // phases
  // ----------------------------------------------------------
  _setPhase(p){
    this.phase = p;
    const build = p === 'build';
    this.$('build-bar').style.display = build ? 'flex' : 'none';
    this.$('roll-actions').classList.toggle('show', p === 'rolling');
    this.$('sel-bar').classList.toggle('show', build && !!this._sel);
    if(this.world.zoneMarker) this.world.zoneMarker.visible = build;
    if(build){
      this.world.syncBall(...[] || this.phys.pos);
      this.world.syncBall(this.phys.pos, true);
      this.rig.frameLevel(this.level);
    }
  }

  launch(){
    if(this.phase !== 'build') return;
    if(this.placements.length === 0){
      Sound.deny();
      this.hooks.toast && this.hooks.toast('Place at least one track module first!');
      return;
    }
    this._select(null);
    Sound.drop(); vibrate(20);
    const s = this.level.start;
    _pt.set(s.p[0], s.p[1], s.p[2]);
    this.phys.setBall(_pt, _startVel.set(0,0,-s.v));
    this.world.resetBallTrail(_pt);
    this.levelTime = 0;
    this.acc = 0;
    this._setPhase('rolling');
    this.rig.follow();
  }

  // return to build keeping placements (fail / Edit Track)
  toBuild(){
    if(this._finishTimer){ clearTimeout(this._finishTimer); this._finishTimer = null; }
    this.phys.compile(this.level, this.placements);
    this._placeBallAtChute();
    this.levelTime = 0;
    this.acc = 0;
    this.ts = 1; this.tsTarget = 1; this.tsTimer = 0;
    this._setPhase('build');
  }

  // ----------------------------------------------------------
  // main update
  // ----------------------------------------------------------
  update(dt){
    this.clock += dt;

    // slow-motion easing
    if(this.tsTimer > 0){
      this.tsTimer -= dt;
      if(this.tsTimer <= 0) this.tsTarget = 1;
    }
    this.ts += (this.tsTarget - this.ts)*Math.min(1, dt*7);

    if(this.phase === 'rolling'){
      this.levelTime += dt;
      this.acc += dt*this.ts;
      let steps = 0;
      while(this.acc >= FIXED_DT && steps < 10){
        this.phys.step(FIXED_DT, this._ev);
        this.acc -= FIXED_DT;
        steps++;
        if(this.phys.done) break;
      }
      this.world.syncBall(this.phys.pos, this.phys.grounded);
      this.$('hud-timer').textContent = this.levelTime.toFixed(1)+'s';
    }

    this.world.update(this.clock, dt);
    this.rig.update(dt, this.phys.pos, this.phys.vel, this.ts);
    this.rig.applyShake(dt);

    // ghost pulse
    if(this._ghost.visible){
      this._ghost.children[0].material.opacity = 0.65+Math.sin(this.clock*7)*0.25;
    }
  }

  // ----------------------------------------------------------
  // physics event hooks
  // ----------------------------------------------------------
  _ev = {
    bounce:(p, power)=>{
      Sound.bounce(power); vibrate(15);
      // find the bounce board module that was hit
      for(const pl of this.placements){
        if(pl.type !== 'bounce') continue;
        const dx = this.phys.pos.x-pl.x, dz = this.phys.pos.z-pl.z;
        if(dx*dx+dz*dz < 1.2){ this.world.triggerModule(pl.uid, 'bounce'); break; }
      }
      this.rig.kick(0.12);
    },
    thud:(p, power)=>{
      if(Math.random() < 0.3) Sound.rollTick();
      this.rig.kick(power*0.08);
    },
    capture:(type)=>{
      if(type === 'magnet'){ Sound.magnet(); this._slowmo(0.4, 0.8); }
      else if(type === 'spiral'){ Sound.spiral(); }
      else if(type === 'antigrav'){ Sound.antigrav(); this._slowmo(0.5, 0.6); }
      else if(type === 'split'){ Sound.tap(); }
      else if(type === 'launcher'){ Sound.tap(); }
      vibrate(10);
    },
    fire:()=>{
      Sound.fire(); vibrate(30);
      this._slowmo(0.35, 0.9);
      this.rig.kick(0.3);
      // trigger recoil on the launcher module
      for(const pl of this.placements){
        if(pl.type === 'launcher'){ this.world.triggerModule(pl.uid, 'fire'); break; }
      }
    },
    arm:(side)=>{
      Sound.split();
      this.world.lastArm = side;
    },
    slingshot:()=>{
      vibrate(20);
      this._slowmo(0.45, 0.6);
      this.rig.kick(0.15);
    },
    finish:()=>{
      this.phase = 'done';
      Sound.finish(); vibrate([30,40,30]);
      this._slowmo(0.3, 0.5);
      this.rig.kick(0.2);
      const time = this.levelTime;
      this._finishTimer = setTimeout(()=>{
        this._finishTimer = null;
        this.hooks.onFinish && this.hooks.onFinish({time});
      }, 900);
    },
    fail:(reason)=>{
      this.phase = 'done';
      Sound.fail(); vibrate(60);
      this.hooks.toast && this.hooks.toast(
        reason === 'fell' ? 'The marble got away! Adjust your track.' :
        reason === 'stuck' ? 'The marble stopped! Keep it moving.' : 'Try again!');
      this._finishTimer = setTimeout(()=>{
        this._finishTimer = null;
        this.toBuild();
      }, 800);
    }
  };

  _slowmo(scale, dur){
    this.tsTarget = scale;
    this.tsTimer = dur;
  }

  // ----------------------------------------------------------
  // dock + placement
  // ----------------------------------------------------------
  _buildDock(){
    const dock = this.$('dock');
    dock.innerHTML = '';
    for(const type of this.level.dock){
      const item = document.createElement('div');
      item.className = 'dock-item';
      item.dataset.mod = type;
      const cv = document.createElement('canvas');
      cv.width = 104; cv.height = 104;
      const ctx = cv.getContext('2d');
      MODULES[type].icon(ctx, 104);
      item.appendChild(cv);
      const badge = document.createElement('span');
      badge.className = 'dock-count';
      item.appendChild(badge);
      item.addEventListener('pointerdown', e=>{
        if(this.phase !== 'build') return;
        e.preventDefault();
        this._startDockDrag(type, e);
      });
      dock.appendChild(item);
    }
    this._refreshDock();
  }

  _refreshDock(){
    const remain = this.level.budget - this.placements.length;
    this.$('dock').querySelectorAll('.dock-item').forEach(el=>{
      el.querySelector('.dock-count').textContent = '×'+remain;
      el.classList.toggle('spent', remain <= 0);
    });
  }

  _startDockDrag(type, e){
    if(this.placements.length >= this.level.budget){
      Sound.deny();
      this.hooks.toast && this.hooks.toast('Module budget used up!');
      return;
    }
    this._select(null);
    this._pid = e.pointerId;
    this._drag = {kind:'new', type};
    try{ this.canvas.setPointerCapture(e.pointerId); }catch(err){}
    this._updateDragFromPointer(e);
  }

  _updateDragFromPointer(e){
    const p = this._planePoint(e);
    if(!p) return;
    const d = this._drag;
    if(!d) return;

    if(d.kind === 'new'){
      const [x,z,ok] = this._snapValid(d.type, 0, p.x, p.z, null);
      this._ghost.visible = true;
      this._ghost.position.set(x, 0, z);
      this._ghost.rotation.y = 0;
      this._ghost.children[0].material.color.set(ok ? 0x7dffc8 : 0xff5f6f);
      this._ghost.children[1].material.color.set(ok ? 0xffffff : 0xffb3b9);
      this._dragValid = ok;
      this._dragPos = [x,z];
    }else if(d.kind === 'move'){
      const pl = this.placements.find(q=>q.uid===d.uid);
      if(!pl) return;
      const px = p.x - d.offX, pz = p.z - d.offZ;
      const [x,z,ok] = this._snapValid(pl.type, pl.rot, px, pz, pl.uid);
      pl.x = x; pl.z = z;
      const g = this.world.moduleGroups.get(pl.uid);
      if(g) g.position.set(x,0,z);
      this._ghost.visible = true;
      this._ghost.position.set(x,0,z);
      this._ghost.rotation.y = pl.rot*Math.PI/2;
      this._ghost.children[0].material.color.set(ok ? 0x7dffc8 : 0xff5f6f);
      this._dragValid = ok;
      d.moved = true;
    }
  }

  _endDrag(e){
    const d = this._drag;
    this._drag = null;
    this._pid = null;
    this._ghost.visible = false;
    if(!d) return;

    if(d.kind === 'new'){
      if(this._dragValid){
        const pl = { type:d.type, x:this._dragPos[0], z:this._dragPos[1], rot:0, uid:this.nextUid++ };
        this.placements.push(pl);
        this.world.addModule(pl);
        Sound.place(); vibrate(12);
        this._select(pl.uid);
        this._refreshDock();
      }else{
        Sound.deny();
        this.hooks.toast && this.hooks.toast('Cannot place it there!');
      }
    }else if(d.kind === 'move'){
      const pl = this.placements.find(q=>q.uid===d.uid);
      if(pl){
        if(this._dragValid){
          if(d.moved){ Sound.tap(); this._select(pl.uid); }
          else{ this._rotate(pl); }   // tap = rotate
        }else{
          // revert to last valid position
          pl.x = d.lastX; pl.z = d.lastZ;
          const g = this.world.moduleGroups.get(pl.uid);
          if(g) g.position.set(pl.x,0,pl.z);
          Sound.deny();
        }
      }
    }
  }

  _rotate(pl){
    const old = pl.rot;
    pl.rot = (pl.rot+1)%4;
    const [,,ok] = this._snapValid(pl.type, pl.rot, pl.x, pl.z, pl.uid);
    if(!ok){ pl.rot = old; Sound.deny(); return; }
    const g = this.world.moduleGroups.get(pl.uid);
    if(g) g.rotation.y = pl.rot*Math.PI/2;
    Sound.rotate();
  }

  // snap (x,z) to grid and validate zone + overlap; returns [x,z,ok]
  _snapValid(type, rot, px, pz, excludeUid){
    const x = Math.round(px/SNAP)*SNAP;
    const z = Math.round(pz/SNAP)*SNAP;
    const zn = this.level.zone;
    const fp = MODULES[type].fp;
    const w = (rot%2===0) ? fp[0] : fp[1];
    const dd = (rot%2===0) ? fp[1] : fp[0];
    let ok =
      x-w/2 >= zn.min[0]-0.01 && x+w/2 <= zn.max[0]+0.01 &&
      z-dd/2 >= zn.min[1]-0.01 && z+dd/2 <= zn.max[1]+0.01;
    if(ok){
      for(const q of this.placements){
        if(q.uid === excludeUid) continue;
        const qfp = MODULES[q.type].fp;
        const qw = (q.rot%2===0) ? qfp[0] : qfp[1];
        const qd = (q.rot%2===0) ? qfp[1] : qfp[0];
        if(Math.abs(q.x-x) < (qw+w)/2 - 0.05 && Math.abs(q.z-z) < (qd+dd)/2 - 0.05){
          ok = false; break;
        }
      }
    }
    return [x,z,ok];
  }

  _planePoint(e){
    const rect = this.canvas.getBoundingClientRect();
    _ndc.set(
      ((e.clientX-rect.left)/rect.width)*2-1,
      -((e.clientY-rect.top)/rect.height)*2+1
    );
    _ray.setFromCamera(_ndc, this.camera);
    const o = _ray.ray.origin, d = _ray.ray.direction;
    if(d.y >= -1e-4) return null;
    const t = -o.y/d.y;
    if(t < 0 || t > 200) return null;
    return _pt.copy(o).addScaledVector(d, t);
  }

  // ----------------------------------------------------------
  // input binding (canvas)
  // ----------------------------------------------------------
  _bindInput(){
    const cv = this.canvas;
    const down = e=>{
      if(this.phase !== 'build' || this.paused) return;
      if(this._pid !== null) return;   // one pointer at a time
      const p = this._planePoint(e);
      if(!p) return;
      // pick nearest placed module
      let best = null, bd = 0.8;
      for(const q of this.placements){
        const dx = q.x-p.x, dz = q.z-p.z;
        const dist = Math.hypot(dx,dz);
        if(dist < bd){ bd = dist; best = q; }
      }
      if(best){
        this._pid = e.pointerId;
        this._drag = {kind:'move', uid:best.uid, offX:best.x-p.x, offZ:best.z-p.z, moved:false,
                      lastX:best.x, lastZ:best.z};
        try{ cv.setPointerCapture(e.pointerId); }catch(err){}
        this._updateDragFromPointer(e);
      }else{
        this._select(null);
      }
      e.preventDefault();
    };
    const move = e=>{
      if(e.pointerId !== this._pid) return;
      this._updateDragFromPointer(e);
      e.preventDefault();
    };
    const up = e=>{
      if(e.pointerId !== this._pid) return;
      this._endDrag(e);
      e.preventDefault();
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    this._unbind = ()=>{
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
    };
  }

  // ----------------------------------------------------------
  // selection actions (wired from main.js)
  // ----------------------------------------------------------
  _select(uid){
    this._sel = uid;
    const bar = this.$('sel-bar');
    if(uid != null){
      const pl = this.placements.find(q=>q.uid===uid);
      bar.classList.toggle('show', this.phase==='build' && !!pl);
      if(pl) this.$('sel-name').textContent = MODULES[pl.type].name;
    }else{
      bar.classList.remove('show');
    }
  }

  rotateSelected(){
    if(this._sel == null) return;
    const pl = this.placements.find(q=>q.uid===this._sel);
    if(pl) this._rotate(pl);
  }

  removeSelected(){
    if(this._sel == null) return;
    const i = this.placements.findIndex(q=>q.uid===this._sel);
    if(i >= 0){
      this.world.removeModule(this._sel);
      this.placements.splice(i,1);
      Sound.remove();
      this._refreshDock();
    }
    this._select(null);
  }

  deselect(){ this._select(null); }

  // ----------------------------------------------------------
  // debug hook (?debug=1) — scripted solvability checks
  // ----------------------------------------------------------
  installDebug(){
    if(!location.search.includes('debug')) return;
    window.__md = {
      game: this,
      place:(type,x,z,rot=0)=>{
        const pl = {type, x, z, rot, uid:this.nextUid++};
        this.placements.push(pl);
        this.world.addModule(pl);
        this._refreshDock();
        return pl.uid;
      },
      launch:()=>this.launch(),
      state:()=>({
        phase:this.phase, time:this.levelTime,
        pos:this.phys.pos.toArray().map(n=>+n.toFixed(3)),
        vel:this.phys.vel.toArray().map(n=>+n.toFixed(3)),
        cap:this.phys.cap ? this.phys.cap.type : null,
        done:this.phys.done
      })
    };
    console.log('[md] debug hook ready: __md.place / __md.launch / __md.state');
  }
}
