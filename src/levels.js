// ============================================================
// levels.js — 12 hand-designed routes across 3 chapters
//
// Coordinates: x = right, y = up, z = toward camera (+) / away (-).
// Every level ejects the marble from a delivery chute toward -z.
// Schema consumed by physics.js / world.js / gameplay.js:
//   start   {p:[x,y,z], v}                 chute mouth + eject speed
//   finish  {p:[x,y,z]}                    finish-ring center
//   floors  [{p:[x,z], s:[w,d]}]           slabs, top surface at y=0
//   fixed   [{p:[x,y,z], s:[w,h,d], ry?}]  solid boxes (walls/platforms)
//   zone    {min:[x,z], max:[x,z]}         build-zone bounds
//   dock    [moduleId,...]                 offered modules
//   budget  N                              max placed modules
//   par     seconds                        time target
// ============================================================

export const THEMES = {
  lab:   'Future Lab',
  candy: 'Candy Factory',
  clock: 'Mechanical Clockwork'
};

export const CHAPTERS = [
  { id:1, theme:'lab',   name:'Future Lab',            levels:[1,2,3,4] },
  { id:2, theme:'candy', name:'Candy Factory',         levels:[5,6,7,8] },
  { id:3, theme:'clock', name:'Mechanical Clockwork',  levels:[9,10,11,12] }
];

export const LEVELS = [

  // ------------------------------------------------ 1 · LAB
  {
    id:1, name:'First Delivery', theme:'lab',
    floors:[{p:[0,0], s:[6,10]}],
    start:{ p:[0,0.55,3.4], v:2.0 },
    finish:{ p:[0,0.62,-3.6] },
    zone:{ min:[-2.4,-2.2], max:[2.4,1.6] },
    dock:['belt'], budget:2,
    par:8,
    hint:'Drag a BOOST BELT into the zone, then tap LAUNCH!'
  },

  // ------------------------------------------------ 2 · LAB
  {
    id:2, name:'Step It Up', theme:'lab',
    floors:[{p:[0,0], s:[6,11]}],
    fixed:[{p:[0,0.5,-3.6], s:[3,1,3]}],
    start:{ p:[0,0.55,3.8], v:2.2 },
    finish:{ p:[0,1.62,-3.6] },
    zone:{ min:[-2.4,-1.8], max:[2.4,1.8] },
    dock:['belt','bounce'], budget:3,
    par:12,
    hint:'Boost with the BELT, then hop onto the platform with the BOUNCE BOARD!'
  },

  // ------------------------------------------------ 3 · LAB
  {
    id:3, name:'Spiral Descent', theme:'lab',
    floors:[{p:[0,0], s:[6,10]}],
    fixed:[{p:[0,1.25,2.3], s:[1.4,2.5,1.4]}],
    start:{ p:[0,2.5,1.9], v:1.6 },
    finish:{ p:[0,0.62,-3.4] },
    zone:{ min:[-1.8,-0.6], max:[1.8,2.0] },
    dock:['spiral'], budget:1,
    par:10,
    hint:'Land the falling marble in the SPIRAL SLIDE funnel!'
  },

  // ------------------------------------------------ 4 · LAB
  {
    id:4, name:'The Launch', theme:'lab',
    floors:[
      {p:[0,1.9],  s:[6,6.2]},
      {p:[0,-5.3], s:[6,5.4]}
    ],
    start:{ p:[0,0.55,3.6], v:2.4 },
    finish:{ p:[0,0.62,-4.8] },
    zone:{ min:[-2.2,-1.9], max:[2.2,0.8] },
    dock:['launcher','belt'], budget:3,
    par:11,
    hint:'Roll into the MARBLE LAUNCHER — it fires across the gap!'
  },

  // ------------------------------------------------ 5 · CANDY
  {
    id:5, name:'Fork in the Road', theme:'candy',
    floors:[{p:[0,0], s:[7,11]}],
    fixed:[{p:[0,0.5,-1.0], s:[0.3,1.0,3.0]}],
    start:{ p:[0,0.55,3.6], v:2.3 },
    finish:{ p:[-1.7,0.62,-3.2] },
    zone:{ min:[-2.6,-2.6], max:[2.6,1.2] },
    dock:['split','belt'], budget:3,
    par:13,
    hint:'The SPLITTER flicks the marble LEFT first, then RIGHT!'
  },

  // ------------------------------------------------ 6 · CANDY
  {
    id:6, name:'Magnetic Personality', theme:'candy',
    floors:[
      {p:[0,2.0],  s:[7,5.6]},
      {p:[0,-5.2], s:[7,5.6]}
    ],
    start:{ p:[0,0.55,3.6], v:3.0 },
    finish:{ p:[0,0.62,-4.9] },
    zone:{ min:[-2.2,-0.75], max:[2.2,0.5] },
    dock:['magnet','belt'], budget:2,
    par:13,
    hint:'The MAGNET RING swirls the marble and slingshots it across the gap!'
  },

  // ------------------------------------------------ 7 · CANDY
  {
    id:7, name:'Candy Conveyor', theme:'candy',
    floors:[{p:[0,0], s:[6,11]}],
    fixed:[{p:[0,0.5,-3.6], s:[3,1,3]}],
    start:{ p:[0,0.55,3.8], v:2.2 },
    finish:{ p:[0,1.62,-3.0] },
    zone:{ min:[-2.4,-2.0], max:[2.4,1.8] },
    dock:['belt','bounce','spiral'], budget:4,
    par:14,
    hint:'Chain it: BELT for speed, then BOUNCE BOARD up to the platform!'
  },

  // ------------------------------------------------ 8 · CANDY
  {
    id:8, name:'Sugar Circuit', theme:'candy',
    floors:[{p:[0,0], s:[7,11]}],
    fixed:[
      {p:[0,0.5,-1.6],    s:[0.3,1.0,2.6]},
      {p:[2.5,0.5,-2.0],  s:[0.3,1.0,2.4]},
      {p:[-1.9,0.5,-4.3], s:[2.2,1.0,0.3]}
    ],
    start:{ p:[0,0.55,3.6], v:2.3 },
    finish:{ p:[-2.9,0.62,-3.6] },
    zone:{ min:[-2.4,-2.4], max:[2.4,1.6] },
    dock:['split'], budget:1,
    par:14,
    hint:'The SPLITTER always flicks LEFT first — line up the perfect shot!'
  },

  // ------------------------------------------------ 9 · CLOCK
  {
    id:9, name:'Clockwork Ascent', theme:'clock',
    floors:[{p:[0,0], s:[6,10]}],
    fixed:[{p:[0,0.5,-1.9], s:[3,1,3]}],
    start:{ p:[0,0.55,3.4], v:2.6 },
    finish:{ p:[0,1.62,-2.6] },
    zone:{ min:[-2.2,-1.0], max:[2.2,1.2] },
    dock:['antigrav','belt'], budget:3,
    par:13,
    hint:'The ANTI-GRAV CURVE lifts the marble up and over!'
  },

  // ------------------------------------------------ 10 · CLOCK
  {
    id:10, name:'Orbital Delivery', theme:'clock',
    floors:[
      {p:[0,1.9],  s:[6,5.8]},
      {p:[0,-5.4], s:[6,5.2]}
    ],
    start:{ p:[0,0.55,3.6], v:2.4 },
    finish:{ p:[0,0.62,-5.0] },
    zone:{ min:[-2.2,-0.9], max:[2.2,0.9] },
    dock:['launcher','magnet'], budget:3,
    par:13,
    hint:'Fire it across — or let the MAGNET slingshot it over!'
  },

  // ------------------------------------------------ 11 · CLOCK
  {
    id:11, name:'The Long Haul', theme:'clock',
    floors:[{p:[0,-0.5], s:[7,14]}],
    start:{ p:[0,0.55,5.6], v:2.0 },
    finish:{ p:[0,0.62,-6.4] },
    zone:{ min:[-2.6,-5.0], max:[2.6,4.0] },
    dock:['belt','antigrav','bounce','magnet'], budget:4,
    par:18,
    hint:'Chain BOOST BELTS to keep the marble rolling all the way!'
  },

  // ------------------------------------------------ 12 · CLOCK
  {
    id:12, name:'Grand Delivery', theme:'clock',
    floors:[{p:[0,2.0], s:[7,7]}],
    fixed:[{p:[0,0.9,-4.6], s:[4.4,1.8,4.4]}],
    start:{ p:[0,0.55,4.2], v:2.4 },
    finish:{ p:[0,2.42,-5.6] },
    zone:{ min:[-2.8,-1.4], max:[2.8,2.6] },
    dock:['belt','bounce','antigrav','launcher','magnet','split','spiral'], budget:5,
    par:20,
    hint:'The grand finale — build any route you can to the tower top!'
  }
];

// ============================================================
// Star rating — pure time trial
// ============================================================
export function starsForTime(t, par){
  if(t <= par-2) return 3;
  if(t <= par)   return 2;
  return 1;
}
