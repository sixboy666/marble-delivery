// ============================================================
// physics.js — marble physics with track-module behaviors.
// Yaw-only OBB colliders (all rotations are 90° steps around Y),
// capture-zone gadget behaviors, finish / fail detection.
// Fixed 120 Hz steps keep the marble from tunneling through
// thin module walls; scratch objects avoid per-step allocations.
// ============================================================

import * as THREE from 'three';
import { MODULES } from './modules.js';

export const BALL_R = 0.16;
const G = 11.5;            // gravity
const AIR = 0.02;          // air drag coefficient
const MU = 0.10;           // rolling friction coefficient (decel = MU*G)
const REST = 0.45;         // wall restitution
const IMPACT = 1.2;        // min impact speed to bounce (else kill normal vel)
const STOP_V = 0.25;       // below this (grounded) the marble counts as stuck
const REST_TIME = 2.2;     // seconds at rest before fail('stuck')
const BELT_ACC = 6.5, BELT_MAX = 7.5;
const BOUNCE_KICK = 6.2;   // guaranteed vertical pop off bounce boards
const FIRE_V = 8;          // launcher muzzle speed
const FAIL_Y = -4;
const STEP_H = 0.30;       // max curb height the marble can roll up onto

// ---------- scratch (no per-step allocation) ----------
const _d = new THREE.Vector3();
const _vt = new THREE.Vector3();
const _contact = { n:new THREE.Vector3(), depth:0 };

const COS = [1,0,-1,0], SIN = [0,1,0,-1];   // yaw per 90° step

// local (lx,ly,lz) + placement {x,z,rot} -> world, written into out
function toWorld(lx, ly, lz, pl, out){
  const c = COS[pl.rot%4], s = SIN[pl.rot%4];
  out.set(pl.x + c*lx + s*lz, ly, pl.z - s*lx + c*lz);
  return out;
}
// world forward (-z local) of a placement, into out
function forwardOf(pl, out){
  const c = COS[pl.rot%4], s = SIN[pl.rot%4];
  out.set(-s, 0, -c);
  return out;
}

// ============================================================
export class PhysicsWorld{
  constructor(){
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.grounded = false;
    this.cap = null;          // active gadget capture state
    this.restT = 0;
    this.splitNext = -1;      // splitter: -1 = left first
    this.boxes = [];          // {c:Vector3, h:Vector3, yaw, kind, e, dir?}
    this.zones = [];          // {c:Vector3, r, type, pl}
    this.finish = { c:new THREE.Vector3(), n:new THREE.Vector3(0,0,-1) };
    this.done = false;
    this._insideZone = null;  // edge-trigger: zone the marble is currently inside
  }

  // ----------------------------------------------------------
  compile(level, placements){
    this.boxes.length = 0;
    this.zones.length = 0;
    this.done = false;
    this.cap = null;
    this.restT = 0;
    this._insideZone = null;

    const v = new THREE.Vector3();

    // floors — slabs with top surface at y=0
    for(const f of level.floors){
      this.boxes.push({
        c:new THREE.Vector3(f.p[0], -0.3, f.p[1]),
        h:new THREE.Vector3(f.s[0]/2, 0.3, f.s[1]/2),
        yaw:0, kind:'ground', e:0.35
      });
    }

    // fixed scenery boxes (walls / platforms)
    for(const b of level.fixed || []){
      this.boxes.push({
        c:new THREE.Vector3(b.p[0], b.p[1], b.p[2]),
        h:new THREE.Vector3(b.s[0]/2, b.s[1]/2, b.s[2]/2),
        yaw:b.ry || 0, kind:'wall', e:0.5
      });
    }

    // placed modules
    for(const pl of placements){
      const def = MODULES[pl.type];
      for(const col of def.colliders){
        toWorld(col.c[0], col.c[1], col.c[2], pl, v);
        const box = {
          c:v.clone(),
          h:new THREE.Vector3(col.s[0]/2, col.s[1]/2, col.s[2]/2),
          yaw:(pl.rot%4)*Math.PI/2,
          kind: col.kind === 'wall' ? 'wall' : col.kind,
          e: col.kind==='bounce' ? 0.92 : 0.45
        };
        if(col.kind === 'belt'){
          box.dir = forwardOf(pl, new THREE.Vector3());
          box.acc = BELT_ACC; box.max = BELT_MAX;
        }
        this.boxes.push(box);
      }
      for(const z of def.zones){
        toWorld(z.c[0], z.c[1], z.c[2], pl, v);
        this.zones.push({ c:v.clone(), r:z.r, type:pl.type, pl });
      }
    }

    // finish ring
    this.finish.c.set(level.finish.p[0], level.finish.p[1], level.finish.p[2]);
    this.finish.n.set(0,0,-1);
  }

  setBall(p, vel){
    this.pos.copy(p);
    this.vel.copy(vel);
    this.cap = null;
    this.restT = 0;
    this.grounded = false;
    this._insideZone = null;
  }

  clearCapture(){ this.cap = null; }

  // ----------------------------------------------------------
  step(dt, ev){
    if(this.done) return;

    if(this.cap){ this._stepCapture(dt, ev); return; }

    // integrate
    this.vel.y -= G*dt;
    this.vel.multiplyScalar(Math.max(0, 1 - AIR*dt));
    this.pos.addScaledVector(this.vel, dt);

    // collide with every box
    this.grounded = false;
    for(const b of this.boxes){
      if(!sphereBox(this.pos, this.vel, b, BALL_R, dt, this, ev)) continue;
      if(_contact.n.y > 0.55) this.grounded = true;
    }

    // belt acceleration is applied inside contacts; nothing global here

    // capture zones — edge-triggered: fire only when ENTERING a zone, so a
    // gadget that releases the marble inside its own zone cannot re-capture
    // it (re-capture becomes possible again after the marble leaves).
    let inZ = null;
    for(const z of this.zones){
      _d.subVectors(this.pos, z.c);
      if(_d.lengthSq() < z.r*z.r){ inZ = z; break; }
    }
    if(inZ){
      if(this._insideZone !== inZ){
        this._insideZone = inZ;
        this._startCapture(inZ, ev);
      }
    }else{
      this._insideZone = null;
    }

    // finish ring
    if(!this.done){
      _d.subVectors(this.pos, this.finish.c);
      const along = _d.dot(this.finish.n);
      _vt.copy(this.finish.n).multiplyScalar(along);
      _d.sub(_vt);
      if(Math.abs(along) < 0.25 && _d.lengthSq() < 0.36 && this.vel.lengthSq() > 0.2){
        this.done = true;
        ev.finish && ev.finish();
        return;
      }
    }

    // fail: fell off the world
    if(this.pos.y < FAIL_Y){
      this.done = true;
      ev.fail && ev.fail('fell');
      return;
    }

    // fail: stuck at rest
    if(this.grounded && this.vel.lengthSq() < STOP_V*STOP_V){
      this.restT += dt;
      if(this.restT > REST_TIME){
        this.done = true;
        ev.fail && ev.fail('stuck');
        return;
      }
    }else{
      this.restT = 0;
    }
  }

  // ----------------------------------------------------------
  // gadget captures
  // ----------------------------------------------------------
  _startCapture(z, ev){
    const f = forwardOf(z.pl, new THREE.Vector3());
    const vH = Math.hypot(this.vel.x, this.vel.z);
    const cx = z.c.x, cz = z.c.z;

    if(z.type === 'spiral'){
      const theta0 = Math.atan2(this.pos.x - cx, this.pos.z - cz);
      this.cap = { type:'spiral', z, f, vH,
        theta:0, theta0, total:Math.PI*2*1.15,
        omega: Math.max(6, vH/0.42), center:z.c.clone() };
      ev.capture && ev.capture('spiral');

    }else if(z.type === 'split'){
      this.cap = { type:'split', z, f, vH, t:0, hold:0.24,
        hub:toWorld(0,0.45,0,z.pl,new THREE.Vector3()) };
      ev.capture && ev.capture('split');

    }else if(z.type === 'magnet'){
      const oy = Math.min(1.1, Math.max(0.2, this.pos.y));
      // release happens on the FORWARD side of the ring (past the housing,
      // clear shot) — one full swirl plus whatever angle remains to get there
      const phi0 = Math.atan2(this.pos.x-cx, this.pos.z-cz);
      const phiT = Math.atan2(f.x, f.z);
      let delta = phiT - phi0;
      while(delta < 0) delta += Math.PI*2;
      this.cap = { type:'magnet', z, f, vH,
        phi:phi0,
        omega: Math.max(8, vH/0.5),
        center:new THREE.Vector3(cx, oy, cz), turned:0, total:Math.PI*2 + delta };
      ev.capture && ev.capture('magnet');

    }else if(z.type === 'antigrav'){
      this.cap = { type:'antigrav', z, f, vH,
        phi:-1.15, phi1:Math.PI/2,
        omega: Math.max(vH,4.5)/0.6,
        center:toWorld(0,0.75,0.1,z.pl,new THREE.Vector3()) };
      ev.capture && ev.capture('antigrav');

    }else if(z.type === 'launcher'){
      this.cap = { type:'launcher', z, f, vH, t:0, hold:0.35,
        breech:toWorld(0,0.4,0.3,z.pl,new THREE.Vector3()) };
      ev.capture && ev.capture('launcher');
    }
  }

  _stepCapture(dt, ev){
    const c = this.cap;

    if(c.type === 'spiral'){
      c.theta += c.omega*dt;
      const th = c.theta0 + c.theta;
      const drop = (c.theta/c.total)*1.75;
      this.pos.set(
        c.center.x + Math.sin(th)*0.42,
        c.center.y - drop,
        c.center.z + Math.cos(th)*0.42
      );
      this.vel.set(0,0,0);
      if(c.theta >= c.total){
        const sp = Math.min(6.5, Math.sqrt(c.vH*c.vH + 2*G*1.7)*0.9);
        toWorld(0,0.2,-0.55,c.z.pl,this.pos);
        this.vel.copy(c.f).multiplyScalar(sp);
        this.cap = null;
      }

    }else if(c.type === 'split'){
      c.t += dt;
      this.pos.copy(c.hub);
      this.vel.set(0,0,0);
      if(c.t >= c.hold){
        const side = this.splitNext;          // -1 left first
        this.splitNext = -side;
        // ±35° yaw from forward — rotation ONLY (a direction, not a point)
        const cr = COS[c.z.pl.rot%4], sr = SIN[c.z.pl.rot%4];
        _vt.set(cr*(side*0.574) + sr*(-0.819), 0, -sr*(side*0.574) + cr*(-0.819));
        const sp = Math.max(c.vH, 4.0);
        this.vel.copy(_vt).multiplyScalar(sp);
        this.pos.copy(c.hub).addScaledVector(_vt, 0.5);
        this.pos.y = 0.45;
        this.cap = null;
        ev.arm && ev.arm(side);
      }

    }else if(c.type === 'magnet'){
      c.phi += c.omega*dt;
      const R = 0.5;
      this.pos.set(
        c.center.x + Math.sin(c.phi)*R,
        c.center.y,
        c.center.z + Math.cos(c.phi)*R
      );
      this.vel.set(0,0,0);
      c.turned += c.omega*dt;
      if(c.turned >= c.total){
        // snap to the forward-side release point, clear of the housing
        this.pos.set(c.center.x + c.f.x*0.5, c.center.y, c.center.z + c.f.z*0.5);
        const sp = Math.max(c.vH*2, 8);   // strong enough to clear gaps solo
        this.vel.copy(c.f).multiplyScalar(sp);
        this.vel.y = 3.0;
        this.cap = null;
        ev.slingshot && ev.slingshot();
      }

    }else if(c.type === 'antigrav'){
      c.phi += c.omega*dt;
      this.pos.set(
        c.center.x,
        c.center.y + Math.sin(c.phi)*0.6,
        c.center.z + Math.cos(c.phi)*0.6
      );
      this.vel.set(0,0,0);
      if(c.phi >= c.phi1){
        const sp = Math.max(c.vH, 4.5);
        toWorld(0,1.35,-0.55,c.z.pl,this.pos);
        this.vel.copy(c.f).multiplyScalar(sp);
        this.cap = null;
      }

    }else if(c.type === 'launcher'){
      c.t += dt;
      this.pos.copy(c.breech);
      this.vel.set(0,0,0);
      if(c.t >= c.hold){
        toWorld(0,0.45,-0.55,c.z.pl,this.pos);
        this.vel.copy(c.f).multiplyScalar(FIRE_V);
        this.cap = null;
        ev.fire && ev.fire();
      }
    }
  }
}

// ------------------------------------------------------------
// sphere vs yaw-rotated box. Returns true on contact; writes
// _contact {n, depth} and applies position/velocity response.
// ------------------------------------------------------------
function sphereBox(p, vel, b, r, dt, phys, ev){
  const dx = p.x - b.c.x, dy = p.y - b.c.y, dz = p.z - b.c.z;
  const cy = Math.cos(b.yaw), sy = Math.sin(b.yaw);
  // world delta -> box-local
  const lx =  cy*dx + sy*dz;
  const ly =  dy;
  const lz = -sy*dx + cy*dz;
  const hx = b.h.x, hy = b.h.y, hz = b.h.z;

  const qx = Math.max(-hx, Math.min(hx, lx));
  const qy = Math.max(-hy, Math.min(hy, ly));
  const qz = Math.max(-hz, Math.min(hz, lz));

  let nlx = lx-qx, nly = ly-qy, nlz = lz-qz;
  let dist2 = nlx*nlx + nly*nly + nlz*nlz;

  if(dist2 > r*r) return false;

  let depth;
  if(dist2 > 1e-10){
    const dist = Math.sqrt(dist2);
    depth = r - dist;
    nlx/=dist; nly/=dist; nlz/=dist;
  }else{
    // center inside the box — push out along the least-penetrated axis
    const px = hx - Math.abs(lx), py = hy - Math.abs(ly), pz = hz - Math.abs(lz);
    if(px <= py && px <= pz){ nlx = lx>=0?1:-1; nly=0; nlz=0; depth = r+px; }
    else if(py <= pz){       nlx = 0; nly = ly>=0?1:-1; nlz=0; depth = r+py; }
    else{                    nlx = 0; nly = 0; nlz = lz>=0?1:-1; depth = r+pz; }
  }

  // local normal -> world
  const n = _contact.n;
  n.set(cy*nlx + sy*nlz, nly, -sy*nlx + cy*nlz);

  // Step-up assist: shallow curbs (belt lanes, bounce boards) are mounted
  // instead of bounced off — the marble lifts onto the box top and keeps
  // its horizontal velocity. Tall module walls and scenery are unaffected.
  const step = (b.c.y + b.h.y) - (p.y - r);
  if(n.y < 0.3 && step > 0.01 && step <= STEP_H && vel.y <= 0.01){
    p.y = b.c.y + b.h.y + r + 0.001;
    n.set(0,1,0);
    _contact.depth = 0;
    const vn0 = vel.dot(n);
    if(vn0 < 0) vel.addScaledVector(n, -vn0);
    _vt.copy(vel).addScaledVector(n, -vel.dot(n));
    const sp0 = _vt.length();
    if(sp0 > 1e-4){
      const f0 = Math.max(0, sp0 - MU*G*dt)/sp0;
      vel.addScaledVector(_vt, f0-1);
    }
    if(b.kind === 'belt'){
      const vd = vel.dot(b.dir);
      if(vd < b.max) vel.addScaledVector(b.dir, Math.min(b.acc*dt, b.max - vd));
    }
    return true;
  }

  const wdepth = _contact.depth = depth;

  // positional correction
  p.addScaledVector(n, wdepth);

  // velocity response
  const vn = vel.dot(n);
  if(vn < 0){
    if(b.kind === 'bounce'){
      vel.addScaledVector(n, -vn*(1+0.92));
      if(n.y > 0.7 && vel.y < BOUNCE_KICK) vel.y = BOUNCE_KICK;
      ev && ev.bounce && ev.bounce(p, Math.min(1, -vn/6));
    }else{
      const impact = -vn;
      if(impact > IMPACT) vel.addScaledVector(n, -vn*(1+b.e));
      else vel.addScaledVector(n, -vn);   // kill normal velocity (rest contact)
      if(b.kind === 'ground' || b.kind === 'wall' || b.kind === 'belt'){
        // rolling friction on the tangential component
        _vt.copy(vel).addScaledVector(n, -vel.dot(n));
        const sp = _vt.length();
        if(sp > 1e-4){
          const f = Math.max(0, sp - MU*G*dt)/sp;
          vel.addScaledVector(_vt, f-1);
        }
        if(b.kind === 'belt'){
          const vd = vel.dot(b.dir);
          if(vd < b.max) vel.addScaledVector(b.dir, Math.min(b.acc*dt, b.max - vd));
        }
      }
      if(impact > 2) ev && ev.thud && ev.thud(p, Math.min(1, impact/8));
    }
  }
  return true;
}
