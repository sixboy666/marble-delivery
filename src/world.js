// ============================================================
// world.js — builds all 3D visuals: themed floors, fixed scenery,
// delivery chute, finish ring, placed track modules, the marble.
// Every model has real geometric thickness (RoundedBox / solids).
// Static scenery is merged into few draw calls per material.
// ============================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALL_R } from './physics.js';
import { MODULES } from './modules.js';

// ----------------------------------------------------------
// theme palettes
// ----------------------------------------------------------
const PAL = {
  lab:{
    bg:0x18223c, ground:0x1c2946, slab:0x2c3d63, slabTop:0x38507e,
    edge:0x9fc4ff, wall:0x4a5f92, wallCap:0xbfe0ff, accent:0x5ec8ff,
    glow:0x67e4ff, chute:0x5b6f9e, ring:0x67e4ff, deco:0x3a4c78,
    belt:0x67d97a, bounce:0xe85a8f, spiral:0x5ec8ff, split:0xffd25e,
    magnet:0xc99cff, antigrav:0x7dffc8, launcher:0xff9a5c
  },
  candy:{
    bg:0x3c1f38, ground:0x4a2642, slab:0x87486f, slabTop:0xa65c88,
    edge:0xffd9ec, wall:0xd96a98, wallCap:0xfff1f7, accent:0xff8fc4,
    glow:0xffb6d9, chute:0xb2558a, ring:0xffd25e, deco:0x6e3a5c,
    belt:0x67d97a, bounce:0xff5f8f, spiral:0x58c8e8, split:0xffe066,
    magnet:0xc99cff, antigrav:0x7dffc8, launcher:0xff9a5c
  },
  clock:{
    bg:0x2a2118, ground:0x33281c, slab:0x5c4630, slabTop:0x75593c,
    edge:0xf2d9a8, wall:0x8a6a44, wallCap:0xffdca0, accent:0xffb347,
    glow:0xffd27a, chute:0x6e5638, ring:0xffd27a, deco:0x453622,
    belt:0x67d97a, bounce:0xe85a6f, spiral:0xd9a441, split:0xffe066,
    magnet:0xc99cff, antigrav:0x7dffc8, launcher:0xff9a5c
  }
};

const COL = new Map([ // module accent colors by type (palette key)
  ['belt','belt'], ['bounce','bounce'], ['spiral','spiral'], ['split','split'],
  ['magnet','magnet'], ['antigrav','antigrav'], ['launcher','launcher']
]);

function shadow(m, cast=true, receive=true){ m.castShadow=cast; m.receiveShadow=receive; return m; }

// ============================================================
export class World{
  constructor(scene){
    this.scene = scene;
    this.group = null;
    this.level = null;
    this.anims = [];          // {fn(t,dt)}
    this.moduleGroups = new Map();   // uid -> group
    this.modMeshes = new Map();      // uid -> {tread|barrel|lights|glow...}
    this.lastArm = -1;
    this._mats = {};
    this._tmpM = new THREE.Matrix4();
    this._tmpQ = new THREE.Quaternion();
    this._up = new THREE.Vector3(0,1,0);
  }

  // --------------------------------------------------------
  load(level){
    this.dispose();
    this.level = level;
    this.pal = PAL[level.theme];
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.anims = [];
    this.moduleGroups.clear();
    this.modMeshes.clear();
    this._mats = {};

    // sky + distant ground
    this.scene.background = new THREE.Color(this.pal.bg);
    const gnd = new THREE.Mesh(
      new THREE.PlaneGeometry(140,140),
      this._m(this.pal.ground, {roughness:1})
    );
    gnd.rotation.x = -Math.PI/2; gnd.position.y = -2.8;
    gnd.receiveShadow = true;
    this.group.add(gnd);

    const statics = [];   // {geo, mat, cast}

    // ---- floor slabs ----
    for(const f of level.floors){
      const w=f.s[0], d=f.s[1];
      statics.push({ geo:new RoundedBoxGeometry(w,0.6,d,2,0.1),
        mat:this._m(this.pal.slab,{roughness:0.85}), cast:false });
      const top = new THREE.Mesh(new RoundedBoxGeometry(w-0.14,0.1,d-0.14,1,0.05),
        this._m(this.pal.slabTop,{roughness:0.7}));
      top.position.set(f.p[0],0.0,f.p[1]);
      statics.push({geo:top.geometry, mat:top.material, cast:false, pos:[f.p[0],0.0,f.p[1]]});
      top.geometry.dispose();
      // edge trim
      const trim = new THREE.Mesh(new RoundedBoxGeometry(w+0.08,0.1,d+0.08,1,0.05),
        this._m(this.pal.edge,{roughness:0.5}));
      trim.position.set(f.p[0],-0.24,f.p[1]);
      statics.push({geo:trim.geometry, mat:trim.material, cast:false, pos:[f.p[0],-0.24,f.p[1]]});
      trim.geometry.dispose();
    }

    // ---- fixed scenery boxes ----
    for(const b of level.fixed || []){
      const g = new RoundedBoxGeometry(b.s[0],b.s[1],b.s[2],2,0.06);
      statics.push({ geo:g, mat:this._m(this.pal.wall,{roughness:0.8}),
        pos:[b.p[0],b.p[1],b.p[2]], rotY:b.ry||0 });
      // bright cap
      const cg = new RoundedBoxGeometry(b.s[0]+0.06,0.09,b.s[2]+0.06,1,0.04);
      statics.push({ geo:cg, mat:this._m(this.pal.wallCap,{roughness:0.5}),
        pos:[b.p[0],b.p[1]+b.s[1]/2+0.03,b.p[2]], rotY:b.ry||0 });
    }

    // ---- delivery chute ----
    this._buildChute(statics, level.start);

    // ---- finish ring (dynamic — animated) ----
    this._buildFinish(level.finish);

    // ---- build-zone marker ----
    this._buildZoneMarker(level.zone);

    // ---- theme decor ----
    this._buildDecor(statics, level);

    // merge statics by material
    this._mergeStatics(statics);

    // ---- the marble ----
    this._buildBall();

    return this.group;
  }

  // --------------------------------------------------------
  _m(color, opts={}){
    const key = color+'|'+JSON.stringify(opts);
    let m = this._mats[key];
    if(!m){ m = new THREE.MeshStandardMaterial({color, roughness:0.7, metalness:0.05, ...opts}); this._mats[key]=m; }
    return m;
  }

  _mergeStatics(list){
    const byMat = new Map();
    for(const it of list){
      const g = it.geo.clone();
      const mat = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(it.rotX||0, it.rotY||0, 0, 'YXZ'));
      mat.compose(new THREE.Vector3(...(it.pos||[0,0,0])), q, new THREE.Vector3(1,1,1));
      g.applyMatrix4(mat);
      if(!byMat.has(it.mat.uuid)) byMat.set(it.mat.uuid, {mat:it.mat, geos:[], cast:it.cast!==false});
      byMat.get(it.mat.uuid).geos.push(g);
    }
    for(const {mat, geos, cast} of byMat.values()){
      const merged = mergeGeometries(geos, false);
      geos.forEach(g=>g.dispose());
      if(!merged) continue;
      const mesh = shadow(new THREE.Mesh(merged, mat), cast, true);
      this.group.add(mesh);
    }
  }

  // --------------------------------------------------------
  _buildChute(statics, start){
    const [sx,sy,sz] = start.p;
    const mat = this._m(this.pal.chute,{roughness:0.6});
    const cap = this._m(this.pal.wallCap,{roughness:0.5});
    // tilted ramp
    statics.push({ geo:new RoundedBoxGeometry(1.0,0.16,1.5,2,0.06), mat,
      pos:[sx,sy-0.12,sz+0.45], rotX:-0.34 });
    statics.push({ geo:new RoundedBoxGeometry(1.06,0.1,0.5,1,0.04), mat:cap,
      pos:[sx,sy-0.02,sz+1.05], rotX:-0.34 });
    // side rails
    statics.push({ geo:new RoundedBoxGeometry(0.12,0.34,1.5,1,0.05), mat,
      pos:[sx-0.52,sy+0.08,sz+0.45], rotX:-0.34 });
    statics.push({ geo:new RoundedBoxGeometry(0.12,0.34,1.5,1,0.05), mat,
      pos:[sx+0.52,sy+0.08,sz+0.45], rotX:-0.34 });
    // glow arrow decal (flat, above ramp)
    statics.push({ geo:new THREE.ConeGeometry(0.16,0.4,4), 
      mat:this._m(this.pal.accent,{emissive:this.pal.accent, emissiveIntensity:0.9, roughness:0.4}),
      pos:[sx,sy+0.12,sz+0.15], rotX:Math.PI/2-0.34 });
  }

  _buildFinish(finish){
    const g = new THREE.Group();
    g.position.set(finish.p[0], finish.p[1], finish.p[2]);
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.5,0.08,10,36),
      this._m(this.pal.ring,{emissive:this.pal.ring, emissiveIntensity:1.2, roughness:0.3, metalness:0.3})
    );
    g.add(torus);
    // sparkle sprites orbiting
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map:dotTexture(), color:0xffffff, transparent:true, opacity:0.9,
      blending:THREE.AdditiveBlending, depthWrite:false }));
    spr.scale.set(0.6,0.6,1);
    g.add(spr);
    this.group.add(g);
    this.finishGroup = g;
    this.anims.push({fn:(t,dt)=>{
      g.rotation.y += dt*1.2;
      torus.rotation.z += dt*0.8;
      const s = 0.55+Math.sin(t*4)*0.12;
      spr.scale.set(s,s,1);
    }});
  }

  _buildZoneMarker(zone){
    const w = zone.max[0]-zone.min[0], d = zone.max[1]-zone.min[1];
    const cx=(zone.min[0]+zone.max[0])/2, cz=(zone.min[1]+zone.max[1])/2;
    const g = new THREE.Group();
    // translucent fill
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w,d),
      new THREE.MeshBasicMaterial({color:0x8fd0ff, transparent:true, opacity:0.06, depthWrite:false}));
    fill.rotation.x = -Math.PI/2; fill.position.set(cx,0.02,cz);
    g.add(fill);
    // dashed border (line segments)
    const hw=w/2, hd=d/2;
    const pts=[];
    const seg=(x1,z1,x2,z2,n)=>{ for(let i=0;i<n;i++){
      const u0=i/n, u1=(i+0.55)/n;
      pts.push(x1+(x2-x1)*u0, 0.03, z1+(z2-z1)*u0, x1+(x2-x1)*u1, 0.03, z1+(z2-z1)*u1);
    }};
    seg(cx-hw,cz-hd,cx+hw,cz-hd,8); seg(cx-hw,cz+hd,cx+hw,cz+hd,8);
    seg(cx-hw,cz-hd,cx-hw,cz+hd,6); seg(cx+hw,cz-hd,cx+hw,cz+hd,6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts,3));
    const line = new THREE.LineSegments(geo,
      new THREE.LineBasicMaterial({color:0x9fd8ff, transparent:true, opacity:0.7}));
    g.add(line);
    g.visible = true;
    this.zoneMarker = g;
    this.group.add(g);
  }

  _buildDecor(statics, level){
    // a few floating theme accents around the playfield
    const mat = this._m(this.pal.deco,{roughness:0.75});
    const glowMat = this._m(this.pal.glow,{emissive:this.pal.glow, emissiveIntensity:0.8, roughness:0.4});
    let minX=1e9,maxZ=-1e9;
    for(const f of level.floors){
      minX=Math.min(minX,f.p[0]-f.s[0]/2); maxZ=Math.max(maxZ,f.p[1]+f.s[1]/2);
    }
    const spots = [
      [minX-1.6, -1.0, 2.2, 0.5], [minX-2.3, -1.6, -2.0, 0.7],
      [minX-1.9, -0.7, -5.5, 0.45], [minX-2.6, -2.1, 0.4, 0.6]
    ];
    for(const [x,y,z,s] of spots){
      statics.push({ geo:new RoundedBoxGeometry(s,s,s,2,s*0.18), mat, pos:[x,y,z], rotY:Math.random()*1.5 });
      statics.push({ geo:new THREE.SphereGeometry(s*0.22,10,8), mat:glowMat, pos:[x+s*0.3,y+s*0.42,z] });
    }
  }

  // ========================================================
  // placed track modules
  // ========================================================
  addModule(pl){
    if(this.moduleGroups.has(pl.uid)) return;
    const def = MODULES[pl.type];
    const color = this.pal[COL.get(pl.type)];
    const g = new THREE.Group();
    g.position.set(pl.x, 0, pl.z);
    g.rotation.y = (pl.rot%4)*Math.PI/2;
    const extra = {};
    this['_mod_'+pl.type](g, color, extra);
    g.userData.uid = pl.uid;
    this.group.add(g);
    this.moduleGroups.set(pl.uid, g);
    this.modMeshes.set(pl.uid, extra);
  }

  removeModule(uid){
    const g = this.moduleGroups.get(uid);
    if(!g) return;
    this.group.remove(g);
    g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); });
    this.moduleGroups.delete(uid);
    this.modMeshes.delete(uid);
  }

  clearModules(){
    for(const uid of [...this.moduleGroups.keys()]) this.removeModule(uid);
  }

  // ---------------- per-type builders ----------------
  _rb(w,h,d,mat,x=0,y=0,z=0,seg=2,r=0.06){
    const m = shadow(new THREE.Mesh(new RoundedBoxGeometry(w,h,d,seg,r), mat));
    m.position.set(x,y,z);
    return m;
  }

  _mod_belt(g, color, extra){
    const dark = this._m(0x2b3444,{roughness:0.85});
    g.add(this._rb(0.95,0.24,1.3,dark,0,0.10,0));
    // animated tread strip
    const tex = treadTexture(color);
    const tread = new THREE.Mesh(new THREE.BoxGeometry(0.78,0.06,1.2),
      new THREE.MeshStandardMaterial({map:tex, roughness:0.6, color:0xffffff}));
    shadow(tread); tread.position.set(0,0.25,0);
    g.add(tread);
    extra.tread = tex;
    // rollers + rails
    for(const z of [-0.62,0.62]){
      const roll = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,0.8,12), this._m(color,{roughness:0.4,metalness:0.3})));
      roll.rotation.x = Math.PI/2; roll.position.set(0,0.18,z);
      g.add(roll);
    }
    g.add(this._rb(0.07,0.16,1.3,this._m(color,{roughness:0.5}),-0.44,0.28,0,1,0.03));
    g.add(this._rb(0.07,0.16,1.3,this._m(color,{roughness:0.5}), 0.44,0.28,0,1,0.03));
    this.anims.push({fn:(t,dt)=>{ tex.offset.y -= dt*0.9; }});
  }

  _mod_bounce(g, color, extra){
    const dark = this._m(0x3a2530,{roughness:0.8});
    g.add(this._rb(0.95,0.14,0.95,dark,0,0.05,0));
    // springs
    const springMat = this._m(0xbfc7d4,{roughness:0.35,metalness:0.6});
    for(const [x,z] of [[-0.3,-0.3],[0.3,-0.3],[0,0.32]]){
      const sp = shadow(new THREE.Mesh(new THREE.TorusKnotGeometry(0.07,0.028,32,6,2,3), springMat));
      sp.position.set(x,0.16,z);
      g.add(sp);
    }
    // pad
    const pad = this._rb(0.95,0.12,0.95,this._m(color,{roughness:0.35,metalness:0.1}),0,0.24,0,2,0.05);
    g.add(pad);
    extra.pad = pad;
    pad.userData.squash = 0;
    this.anims.push({fn:(t,dt)=>{
      if(pad.userData.squash > 0){
        pad.userData.squash = Math.max(0, pad.userData.squash - dt*4);
        const s = pad.userData.squash;
        pad.scale.set(1+s*0.25, 1-s*0.55, 1+s*0.25);
        pad.position.y = 0.24 - s*0.07;
      }
    }});
  }

  _mod_spiral(g, color, extra){
    const body = this._m(color,{roughness:0.55,metalness:0.15});
    const dark = this._m(0x333d50,{roughness:0.8});
    // central column + base
    const col = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.2,1.9,12), dark));
    col.position.set(0,0.95,0); g.add(col);
    const base = this._rb(0.9,0.14,0.9,dark,0,0.07,0); g.add(base);
    // helical trough from small boxes (merged)
    const segs = [];
    const total = Math.PI*2*1.15;
    const N = 26;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for(let i=0;i<N;i++){
      const th = (i/N)*total;
      const y = 1.9 - (i/N)*1.72;
      const x = Math.sin(th)*0.42, z = Math.cos(th)*0.42;
      e.set(0, th, 0);   // R_y(th) maps +x to the helix tangent (cos th, -sin th)
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x,y,z), q, new THREE.Vector3(1,1,1));
      const b = new RoundedBoxGeometry(0.4,0.12,0.24,1,0.04);
      b.applyMatrix4(m4);
      segs.push(b);
    }
    // funnel at top
    const fun = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.3,0.35,14,1,true),
      new THREE.MeshStandardMaterial({color, roughness:0.5, metalness:0.15, side:THREE.DoubleSide}));
    fun.position.set(0,2.02,0); shadow(fun);
    g.add(fun);
    const merged = mergeGeometries(segs, false);
    segs.forEach(s=>s.dispose());
    if(merged) g.add(shadow(new THREE.Mesh(merged, body)));
    // top glow beacon
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09,10,8),
      this._m(0xffffff,{emissive:color, emissiveIntensity:1.4, roughness:0.3}));
    tip.position.set(0,2.26,0); g.add(tip);
    extra.tip = tip;
    this.anims.push({fn:(t)=>{ tip.material.emissiveIntensity = 1.1+Math.sin(t*5)*0.5; }});
  }

  _mod_split(g, color, extra){
    const dark = this._m(0x3a3350,{roughness:0.8});
    g.add(this._rb(0.9,0.5,0.9,dark,0,0.25,0));
    const hub = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.34,16,12,0,Math.PI*2,0,Math.PI/2),
      this._m(color,{roughness:0.4,metalness:0.2})));
    hub.position.set(0,0.5,0); g.add(hub);
    // two exit chutes at ±35°
    const chuteMat = this._m(color,{roughness:0.55});
    for(const s of [-1,1]){
      const ch = this._rb(0.3,0.1,0.7,chuteMat, s*0.42,0.34,-0.28,1,0.04);
      ch.rotation.y = s*0.615;
      g.add(ch);
    }
    // entry funnel mouth
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.22,0.05,8,18),
      this._m(0xffffff,{emissive:color, emissiveIntensity:0.9, roughness:0.4}));
    mouth.position.set(0,0.62,0.42); mouth.rotation.x = 0.5;
    g.add(mouth);
    // arm indicator lights
    const lights = [];
    for(const s of [-1,1]){
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07,10,8),
        new THREE.MeshStandardMaterial({color:0xffffff, emissive:color, emissiveIntensity:0.25, roughness:0.4}));
      dot.position.set(s*0.46,0.52,-0.5);
      g.add(dot); lights.push(dot);
    }
    extra.lights = lights;
    this.anims.push({fn:(t,dt)=>{
      lights[0].material.emissiveIntensity += ((this.lastArm===-1?1.5:0.2) - lights[0].material.emissiveIntensity)*dt*6;
      lights[1].material.emissiveIntensity += ((this.lastArm=== 1?1.5:0.2) - lights[1].material.emissiveIntensity)*dt*6;
    }});
  }

  _mod_magnet(g, color, extra){
    const dark = this._m(0x3c3450,{roughness:0.8});
    g.add(this._rb(0.5,0.4,0.5,dark,0,0.2,0));
    const ring = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.5,0.07,10,32),
      this._m(color,{roughness:0.35,metalness:0.4})));
    ring.position.set(0,0.9,0); g.add(ring);
    const glow = new THREE.Mesh(new THREE.TorusGeometry(0.5,0.028,8,32),
      new THREE.MeshStandardMaterial({color:0xffffff, emissive:color, emissiveIntensity:1.2, roughness:0.3}));
    glow.position.set(0,0.9,0); g.add(glow);
    extra.glow = glow;
    // orbiting spark
    const spark = new THREE.Sprite(new THREE.SpriteMaterial({map:dotTexture(), color,
      transparent:true, blending:THREE.AdditiveBlending, depthWrite:false}));
    spark.scale.set(0.3,0.3,1); g.add(spark);
    this.anims.push({fn:(t,dt)=>{
      glow.material.emissiveIntensity = 1.0+Math.sin(t*6)*0.5;
      spark.position.set(Math.cos(t*2.4)*0.58, 0.9, Math.sin(t*2.4)*0.58);
    }});
  }

  _mod_antigrav(g, color, extra){
    const dark = this._m(0x2e4640,{roughness:0.8});
    g.add(this._rb(0.9,0.55,0.5,dark,0,0.27,0.42));
    // curved trough: segment boxes along the arc (merged)
    const body = this._m(color,{roughness:0.5,metalness:0.15});
    const segs = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const N = 16, phi0 = -1.15, phi1 = Math.PI/2+0.15;
    for(let i=0;i<N;i++){
      const phi = phi0 + (i/N)*(phi1-phi0);
      const y = 0.75 + Math.sin(phi)*0.6;
      const z = 0.1 + Math.cos(phi)*0.6;
      e.set(-phi, 0, 0);   // tangent tilt in YZ plane
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(0,y,z), q, new THREE.Vector3(1,1,1));
      const b = new RoundedBoxGeometry(0.55,0.1,0.2,1,0.04);
      b.applyMatrix4(m4);
      segs.push(b);
    }
    const merged = mergeGeometries(segs, false);
    segs.forEach(s=>s.dispose());
    if(merged) g.add(shadow(new THREE.Mesh(merged, body)));
    // glowing underside strips
    const glowMat = new THREE.MeshStandardMaterial({color:0xffffff, emissive:color, emissiveIntensity:1.1, roughness:0.4});
    for(let i=0;i<N;i+=2){
      const phi = phi0 + (i/N)*(phi1-phi0);
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.42,0.03,0.1), glowMat);
      s.position.set(0, 0.75+Math.sin(phi)*0.6-0.09, 0.1+Math.cos(phi)*0.6);
      s.rotation.x = -phi;
      g.add(s);
    }
    // exit chute
    g.add(this._rb(0.5,0.1,0.5, body, 0,1.35,-0.32,1,0.04));
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08,10,8),
      this._m(0xffffff,{emissive:color, emissiveIntensity:1.3, roughness:0.3}));
    tip.position.set(0,1.5,-0.32); g.add(tip);
    this.anims.push({fn:(t)=>{ tip.material.emissiveIntensity = 1.1+Math.sin(t*4.4)*0.5; }});
  }

  _mod_launcher(g, color, extra){
    const dark = this._m(0x463b30,{roughness:0.8});
    g.add(this._rb(0.8,0.24,1.0,dark,0,0.12,0.15));
    // breech box
    g.add(this._rb(0.7,0.5,0.5,this._m(color,{roughness:0.5,metalness:0.2}),0,0.42,0.3));
    // barrel along -z
    const barrel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.24,0.28,0.85,14),
      this._m(color,{roughness:0.4,metalness:0.3})));
    barrel.rotation.x = Math.PI/2;
    barrel.position.set(0,0.48,-0.08);
    g.add(barrel);
    extra.barrel = barrel;
    const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.26,0.05,8,18),
      new THREE.MeshStandardMaterial({color:0xffffff, emissive:color, emissiveIntensity:1.0, roughness:0.35}));
    muzzle.position.set(0,0.48,-0.5);
    g.add(muzzle);
    extra.muzzle = muzzle;
    this.anims.push({fn:(t,dt)=>{
      muzzle.material.emissiveIntensity = 0.8+Math.sin(t*5)*0.4;
      if(extra.recoil > 0){
        extra.recoil = Math.max(0, extra.recoil - dt*3);
        barrel.position.z = -0.08 - extra.recoil*0.22;
        muzzle.position.z = -0.5 - extra.recoil*0.22;
      }
    }});
  }

  triggerModule(uid, what){
    const extra = this.modMeshes.get(uid);
    if(!extra) return;
    if(what==='fire') extra.recoil = 1;
    if(what==='bounce' && extra.pad) extra.pad.userData.squash = 1;
    if(what==='arm') this.lastArm = what.side;
  }

  // ========================================================
  // the marble
  // ========================================================
  _buildBall(){
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color:0xffc25e, roughness:0.15, metalness:0.1,
      emissive:0xff9a20, emissiveIntensity:0.55
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(BALL_R,20,16), mat);
    shadow(core, true, false);
    g.add(core);
    // swirl band
    const band = new THREE.Mesh(new THREE.TorusGeometry(BALL_R*0.99,0.02,6,24),
      new THREE.MeshStandardMaterial({color:0xffffff, emissive:0xffffff, emissiveIntensity:0.7, roughness:0.3}));
    band.rotation.x = Math.PI/2;
    g.add(band);
    // glow sprite
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:dotTexture(), color:0xffc060,
      transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, depthWrite:false}));
    glow.scale.set(0.85,0.85,1);
    g.add(glow);
    // blob shadow
    const sh = new THREE.Mesh(new THREE.CircleGeometry(BALL_R*1.5,16),
      new THREE.MeshBasicMaterial({map:shadowTexture(), transparent:true, opacity:0.42, depthWrite:false}));
    sh.rotation.x = -Math.PI/2;
    this.ballShadow = sh;
    this.scene.add(sh);
    this.ball = g;
    this.ballCore = core;
    this.scene.add(g);
  }

  syncBall(p, grounded){
    this.ball.position.copy(p);
    // roll rotation: axis = up × vel
    this._roll(p);
    // blob shadow follows, y snapped near the floor below
    let sy = 0.045;
    for(const f of this.level.floors){
      if(Math.abs(p.x-f.p[0])<=f.s[0]/2+0.2 && Math.abs(p.z-f.p[1])<=f.s[1]/2+0.2){
        sy = 0.045; break;
      }
    }
    this.ballShadow.position.set(p.x, sy, p.z);
    const h = Math.max(0, p.y);
    this.ballShadow.material.opacity = Math.max(0.08, 0.42 - h*0.1);
    const s = 1 + h*0.25;
    this.ballShadow.scale.set(s,s,1);
  }

  _roll(p){
    // approximate rolling: spin around axis perpendicular to velocity
    if(!this._lastP) this._lastP = new THREE.Vector3().copy(p);
    const dx = p.x-this._lastP.x, dz = p.z-this._lastP.z;
    const dist = Math.hypot(dx,dz);
    if(dist > 1e-5){
      const axis = this._tmpA || (this._tmpA = new THREE.Vector3());
      axis.set(dz,0,-dx).normalize();
      this._tmpQ.setFromAxisAngle(axis, -dist/BALL_R);
      this.ball.quaternion.premultiply(this._tmpQ);
    }
    this._lastP.copy(p);
  }

  resetBallTrail(p){
    if(this._lastP) this._lastP.copy(p);
  }

  // --------------------------------------------------------
  update(t, dt){
    for(const a of this.anims) a.fn(t, dt);
  }

  // ghost ring shown while dragging a module
  makeGhost(){
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55,0.045,8,28),
      new THREE.MeshBasicMaterial({color:0x7dffc8, transparent:true, opacity:0.9}));
    ring.rotation.x = Math.PI/2; ring.position.y = 0.06;
    g.add(ring);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.14,0.36,4),
      new THREE.MeshBasicMaterial({color:0xffffff}));
    arrow.rotation.x = Math.PI/2; arrow.position.set(0,0.06,-0.75);
    g.add(arrow);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  dispose(){
    if(this.ball){ this.scene.remove(this.ball); this.ball = null; }
    if(this.ballShadow){ this.scene.remove(this.ballShadow); this.ballShadow = null; }
    if(this.group){
      this.scene.remove(this.group);
      this.group.traverse(o=>{
        if(o.geometry) o.geometry.dispose();
      });
      for(const k in this._mats) this._mats[k].dispose();
      this.group = null;
    }
    this.anims = [];
    this.moduleGroups.clear();
    this.modMeshes.clear();
  }
}

// ------------------------------------------------------------
// shared canvas textures
// ------------------------------------------------------------
let _dotTex = null;
export function dotTexture(){
  if(_dotTex) return _dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,2,32,32,30);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.4,'rgba(255,255,255,0.5)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
  _dotTex = new THREE.CanvasTexture(c);
  return _dotTex;
}

let _shadowTex = null;
function shadowTexture(){
  if(_shadowTex) return _shadowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32,32,4,32,32,30);
  g.addColorStop(0,'rgba(0,0,0,0.85)');
  g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,64,64);
  _shadowTex = new THREE.CanvasTexture(c);
  return _shadowTex;
}

let _treadTex = null;
function treadTexture(color){
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b3444'; ctx.fillRect(0,0,64,128);
  ctx.fillStyle = '#'+color.toString(16).padStart(6,'0');
  for(let i=0;i<4;i++) ctx.fillRect(0, i*32+6, 64, 14);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for(let i=0;i<4;i++) ctx.fillRect(0, i*32+6, 64, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1,2);
  return tex;
}
