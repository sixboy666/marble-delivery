// ============================================================
// storage.js — persistent progress (localStorage)
// ============================================================

const KEY = 'marble-delivery-save-v1';

const DEFAULT_SAVE = {
  unlocked: 1,            // highest unlocked level id
  best: {},               // levelId -> best time (seconds)
  stars: {},              // levelId -> 0..3
  settings: {
    music: true,
    sfx: true,
    vibe: true,
    quality: 'high'
  }
};

class SaveSystem {
  constructor(){
    this.data = structuredClone(DEFAULT_SAVE);
    this.load();
  }

  load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        this.data = deepMerge(structuredClone(DEFAULT_SAVE), parsed);
      }
    }catch(e){
      console.warn('Save load failed, starting fresh', e);
    }
  }

  save(){
    try{
      localStorage.setItem(KEY, JSON.stringify(this.data));
    }catch(e){ /* storage unavailable — play without saving */ }
  }

  isUnlocked(id){ return id <= this.data.unlocked; }

  getBest(id){ return this.data.best[id] ?? null; }

  getStars(id){ return this.data.stars[id] ?? 0; }

  totalStars(){
    let s = 0;
    for(const k in this.data.stars) s += this.data.stars[k];
    return s;
  }

  /** Record a finished level. Returns {newBest, newUnlock, prevBest} */
  recordResult(levelId, time, starCount){
    const d = this.data;
    let newBest = false;
    const prevBest = d.best[levelId];
    if(prevBest == null || time < prevBest){
      d.best[levelId] = time;
      newBest = true;
    }
    const prevStars = d.stars[levelId] ?? 0;
    if(starCount > prevStars) d.stars[levelId] = starCount;

    let newUnlock = false;
    if(levelId >= d.unlocked){
      d.unlocked = levelId + 1;
      newUnlock = true;
    }
    this.save();
    return {newBest, newUnlock, prevBest};
  }

  getSettings(){ return this.data.settings; }

  updateSetting(key, value){
    this.data.settings[key] = value;
    this.save();
  }

  resetAll(){
    this.data = structuredClone(DEFAULT_SAVE);
    this.save();
  }
}

function deepMerge(base, over){
  for(const k of Object.keys(over)){
    if(over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object'){
      deepMerge(base[k], over[k]);
    }else{
      base[k] = over[k];
    }
  }
  return base;
}

export const Save = new SaveSystem();
