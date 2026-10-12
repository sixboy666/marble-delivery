// ============================================================
// modules.js — the 7 track modules: pure data + physics spec.
// Geometry (meshes) is built in world.js; behavior in physics.js.
//
// Local frame: module origin at floor level, forward = -z at rot 0.
// colliders: {c:[x,y,z], s:[w,h,d], kind}   yaw-only boxes
// zones:     {c:[x,y,z], r}                 capture spheres
// ============================================================

export const MODULES = {

  // ---------------- boost belt ----------------
  belt: {
    name:'Boost Belt',
    fp:[1.0,1.4],
    colliders:[ {c:[0,0.14,0], s:[0.95,0.28,1.3], kind:'belt'} ],
    zones:[],
    icon(ctx,s){ // belt tread with arrow
      const u=s/100;
      ctx.lineWidth=6*u; ctx.strokeStyle='#2ea84f';
      rr(ctx,14*u,30*u,72*u,40*u,10*u); ctx.stroke();
      ctx.fillStyle='#67d97a';
      for(let i=0;i<3;i++){ rr(ctx,(22+i*20)*u,38*u,12*u,24*u,3*u); ctx.fill(); }
      arrow(ctx, 50*u, 16*u, s*0.16, '#ffd25e');
    }
  },

  // ---------------- bounce board ----------------
  bounce: {
    name:'Bounce Board',
    fp:[1.0,1.0],
    colliders:[ {c:[0,0.12,0], s:[0.95,0.24,0.95], kind:'bounce'} ],
    zones:[],
    icon(ctx,s){
      const u=s/100;
      ctx.fillStyle='#e85a8f';
      rr(ctx,16*u,52*u,68*u,14*u,6*u); ctx.fill();
      ctx.strokeStyle='#ffb6c8'; ctx.lineWidth=5*u;
      ctx.beginPath();
      for(let i=0;i<3;i++){
        const x=28*u+i*22*u;
        ctx.moveTo(x-8*u,80*u); ctx.quadraticCurveTo(x,62*u,x+8*u,80*u);
      }
      ctx.stroke();
      arrow(ctx, 50*u, 28*u, s*0.16, '#ffd25e');
    }
  },

  // ---------------- spiral slide ----------------
  spiral: {
    name:'Spiral Slide',
    fp:[1.1,1.1],
    colliders:[
      {c:[0,0.45,0], s:[0.9,0.9,0.9], kind:'wall'},
      {c:[0,0.95,0], s:[0.9,0.1,0.9], kind:'wall'}
    ],
    zones:[ {c:[0,1.95,0], r:0.65} ],
    icon(ctx,s){
      const u=s/100;
      ctx.strokeStyle='#5ec8ff'; ctx.lineWidth=6*u;
      ctx.beginPath();
      for(let a=0;a<Math.PI*3.6;a+=0.15){
        const r=(34-a*5)*u, x=50*u+Math.cos(a)*r, y=42*u+Math.sin(a)*r*0.8+a*4.2*u;
        a===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.stroke();
      dot(ctx,50*u,20*u,7*u,'#fff');
    }
  },

  // ---------------- splitter ----------------
  split: {
    name:'Splitter',
    fp:[1.4,1.0],
    colliders:[ {c:[0,0.25,0], s:[0.9,0.5,0.9], kind:'wall'} ],
    zones:[ {c:[0,0.5,0], r:0.7} ],
    icon(ctx,s){
      const u=s/100;
      ctx.strokeStyle='#ffd25e'; ctx.lineWidth=6*u; ctx.lineCap='round';
      ctx.beginPath();
      ctx.moveTo(50*u,80*u); ctx.lineTo(50*u,52*u);
      ctx.moveTo(50*u,52*u); ctx.lineTo(24*u,26*u);
      ctx.moveTo(50*u,52*u); ctx.lineTo(76*u,26*u);
      ctx.stroke();
      dot(ctx,24*u,24*u,7*u,'#7dffc8');   // left arm lights first
      dot(ctx,76*u,24*u,7*u,'#5a5378');
    }
  },

  // ---------------- magnet ring ----------------
  magnet: {
    name:'Magnet Ring',
    fp:[1.2,0.6],
    colliders:[ {c:[0,0.2,0], s:[0.5,0.4,0.5], kind:'wall'} ],
    zones:[ {c:[0,0.55,0], r:0.62} ],
    icon(ctx,s){
      const u=s/100;
      ctx.strokeStyle='#c99cff'; ctx.lineWidth=9*u;
      ctx.beginPath(); ctx.ellipse(50*u,48*u,26*u,30*u,0,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle='#efe6ff'; ctx.lineWidth=3*u;
      ctx.beginPath(); ctx.ellipse(50*u,48*u,26*u,30*u,0,0,Math.PI*2); ctx.stroke();
      dot(ctx,50*u,48*u,8*u,'#ffd25e');
    }
  },

  // ---------------- anti-gravity curve ----------------
  antigrav: {
    name:'Anti-Grav Curve',
    fp:[1.1,1.3],
    colliders:[ {c:[0,0.3,0.45], s:[0.9,0.6,0.5], kind:'wall'} ],
    zones:[ {c:[0,0.2,0.5], r:0.55} ],
    icon(ctx,s){
      const u=s/100;
      ctx.strokeStyle='#7dffc8'; ctx.lineWidth=7*u;
      ctx.beginPath(); ctx.arc(50*u,58*u,32*u,Math.PI,Math.PI*1.85); ctx.stroke();
      arrow(ctx, 24*u, 74*u, s*0.13, '#fff');
      dot(ctx,50*u,26*u,6*u,'#7dffc8');
    }
  },

  // ---------------- marble launcher ----------------
  launcher: {
    name:'Marble Launcher',
    fp:[0.9,1.2],
    colliders:[ {c:[0,0.35,0.15], s:[0.8,0.7,1.0], kind:'wall'} ],
    zones:[ {c:[0,0.35,0.35], r:0.55} ],
    icon(ctx,s){
      const u=s/100;
      ctx.fillStyle='#ff9a5c';
      ctx.save(); ctx.translate(50*u,54*u); ctx.rotate(-Math.PI/4);
      rr(ctx,-13*u,-42*u,26*u,64*u,10*u); ctx.fill();
      ctx.restore();
      dot(ctx,50*u,84*u,9*u,'#ffd25e');
      arrow(ctx, 50*u, 22*u, s*0.14, '#fff');
    }
  }
};

// footprint radius used for placement overlap (x/z yaw-snapped AABB)
export function footprintOf(type, rot){
  const [w,d] = MODULES[type].fp;
  return (rot%2===0) ? [w,d] : [d,w];
}

// ---------------- icon helpers ----------------
function rr(ctx,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function dot(ctx,x,y,r,col){
  ctx.fillStyle=col; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}
function arrow(ctx,x,y,h,col){
  ctx.fillStyle=col;
  ctx.beginPath();
  ctx.moveTo(x,y-h/2); ctx.lineTo(x+h*0.55,y+h*0.15);
  ctx.lineTo(x+h*0.2,y+h*0.15); ctx.lineTo(x+h*0.2,y+h/2);
  ctx.lineTo(x-h*0.2,y+h/2); ctx.lineTo(x-h*0.2,y+h*0.15);
  ctx.lineTo(x-h*0.55,y+h*0.15);
  ctx.closePath(); ctx.fill();
}
