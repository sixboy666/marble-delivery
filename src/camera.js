// ============================================================
// camera.js — overview rig (build phase) + follow rig (rolling),
// speed-based FOV zoom, slow-motion-aware smoothing.
// ============================================================

import * as THREE from 'three';

const _des = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CamRig{
  constructor(camera){
    this.cam = camera;
    this.mode = 'overview';
    this.shake = 0;

    this._ovPos = new THREE.Vector3(0,14,12);
    this._ovLook = new THREE.Vector3(0,0,0);
    this._lookCur = new THREE.Vector3(0,0,0);
    this._baseFov = camera.fov;
  }

  // frame the whole playfield (zone ∪ start ∪ finish)
  frameLevel(level){
    const pts = [
      level.start.p[0], level.start.p[2],
      level.finish.p[0], level.finish.p[2],
      level.zone.min[0], level.zone.min[1],
      level.zone.max[0], level.zone.max[1]
    ];
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(let i=0;i<pts.length;i+=2){
      minX=Math.min(minX,pts[i]); maxX=Math.max(maxX,pts[i]);
      minZ=Math.min(minZ,pts[i+1]); maxZ=Math.max(maxZ,pts[i+1]);
    }
    // include floors so slabs don't clip the frame edge
    for(const f of level.floors){
      minX=Math.min(minX,f.p[0]-f.s[0]/2); maxX=Math.max(maxX,f.p[0]+f.s[0]/2);
      minZ=Math.min(minZ,f.p[1]-f.s[1]/2); maxZ=Math.max(maxZ,f.p[1]+f.s[1]/2);
    }
    const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
    const spanX=maxX-minX, spanZ=maxZ-minZ;

    // portrait-friendly tilt: keep both x-span and z-span in frame
    const aspect = this.cam.aspect;
    const fitK = Math.max(1, 1.05/aspect);
    const dist = Math.max(spanZ, spanX*fitK)*0.92 + 4.5;
    const elev = dist*0.78 + 3.2;

    this._ovPos.set(cx, elev, cz + dist*0.72);
    this._ovLook.set(cx, 0.4, cz);
    this._lookCur.copy(this._ovLook);

    if(this.mode !== 'follow'){
      this.cam.position.copy(this._ovPos);
      this.cam.lookAt(this._ovLook);
      this.cam.fov = this._baseFov;
      this.cam.updateProjectionMatrix();
    }
    this.mode = 'overview';
  }

  // marble follow cam — offset behind and above, looking ahead
  follow(ball, vel){
    this.mode = 'follow';
  }

  update(dt, ball, vel, timeScale){
    if(this.mode === 'overview'){
      const k = 1 - Math.pow(0.0018, dt);
      this.cam.position.lerp(this._ovPos, k);
      this._lookCur.lerp(this._ovLook, k);
      this.cam.lookAt(this._lookCur);
      this._zoomTo(this._baseFov, dt);
      return;
    }

    // follow: behind the marble relative to its travel direction
    const sp = Math.hypot(vel.x, vel.z);
    let dx = vel.x, dz = vel.z;
    const len = Math.hypot(dx,dz);
    if(len > 0.5){ dx/=len; dz/=len; } else { dx=0; dz=-1; }

    _des.set(
      ball.x - dx*5.2,
      ball.y + 4.6 + sp*0.14,
      ball.z - dz*5.2
    );
    _look.set(ball.x + dx*1.6, ball.y + 0.3, ball.z + dz*1.6);

    const k = 1 - Math.pow(0.002, dt*Math.max(0.35, timeScale));
    this.cam.position.lerp(_des, k);
    this._lookCur.lerp(_look, k*1.2);
    this.cam.lookAt(this._lookCur);

    // speed zoom: fast = wider, stunts = tightened by slow-mo FOV target
    const targetFov = this._baseFov + Math.min(8, sp*1.1) - (timeScale<0.9 ? 6 : 0);
    this._zoomTo(targetFov, dt);
  }

  _zoomTo(fov, dt){
    const k = 1 - Math.pow(0.05, dt);
    const f = this.cam.fov + (fov - this.cam.fov)*k;
    if(Math.abs(f - this.cam.fov) > 0.01){
      this.cam.fov = f;
      this.cam.updateProjectionMatrix();
    }
  }

  // gentle impact nudge (never during aiming/build — no aiming here,
  // so small shakes are safe; scaled down to avoid vertigo)
  kick(amount){
    this.shake = Math.min(0.5, this.shake + amount);
  }

  applyShake(dt){
    if(this.shake > 0.001){
      this.cam.position.x += (Math.random()-0.5)*this.shake*0.3;
      this.cam.position.y += (Math.random()-0.5)*this.shake*0.2;
      this.shake *= Math.pow(0.0001, dt);
    }
  }
}
