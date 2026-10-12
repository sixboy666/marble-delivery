// ============================================================
// audio.js — synthesized sound effects + background music
// (WebAudio only, no asset files)
// ============================================================

import { Save } from './storage.js';

class AudioEngine {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  init(){
    if(this.ctx){
      if(this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.8;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.26;
    this.musicGain.connect(this.master);
  }

  get enabled(){ return this.ctx && Save.getSettings().sfx; }

  // ------------- primitive helpers -------------
  _blip({freq=440, end=null, dur=0.12, type='sine', vol=0.3, attack=0.005, delay=0, dest=null}){
    if(!this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if(end) osc.frequency.exponentialRampToValueAtTime(Math.max(1,end), t+dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t+attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    osc.connect(g); g.connect(dest || this.sfxGain);
    osc.start(t); osc.stop(t+dur+0.02);
  }

  _noise({dur=0.1, vol=0.25, freq=1200, q=1, type='bandpass', slide=null}){
    if(!this.enabled) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<len;i++) data[i] = (Math.random()*2-1) * (1 - i/len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.frequency.setValueAtTime(freq, t);
    if(slide) filt.frequency.exponentialRampToValueAtTime(slide, t+dur);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t);
  }

  // ------------- UI -------------
  ui(){ this._blip({freq:620, end:880, dur:0.08, type:'triangle', vol:0.22}); }
  tap(){ this._blip({freq:500, end:380, dur:0.06, type:'triangle', vol:0.18}); }

  // ------------- game -------------
  place(){ this._blip({freq:340, end:560, dur:0.12, type:'triangle', vol:0.3});
           this._noise({dur:0.06, vol:0.12, freq:2000}); }
  rotate(){ this._blip({freq:760, end:980, dur:0.07, type:'square', vol:0.12}); }
  remove(){ this._blip({freq:520, end:240, dur:0.14, type:'triangle', vol:0.22}); }
  deny(){ this._blip({freq:220, end:160, dur:0.16, type:'square', vol:0.16}); }

  drop(){ this._noise({dur:0.25, vol:0.2, freq:600, slide:2200}); }

  bounce(p=0.6){
    this._blip({freq:180+p*160, end:520+p*260, dur:0.16, type:'sine', vol:0.34});
    this._noise({dur:0.05, vol:0.15, freq:900});
  }
  belt(){ this._blip({freq:140, end:260, dur:0.22, type:'sawtooth', vol:0.1}); }
  magnet(){
    this._blip({freq:300, end:600, dur:0.4, type:'sine', vol:0.2});
    this._blip({freq:450, end:900, dur:0.4, type:'sine', vol:0.12, delay:0.05});
  }
  spiral(){ // little slide-whistle run
    for(let i=0;i<5;i++) this._blip({freq:900-i*130, dur:0.09, type:'sine', vol:0.14, delay:i*0.07});
  }
  split(){ this._blip({freq:660, end:880, dur:0.1, type:'triangle', vol:0.25}); }
  antigrav(){ this._blip({freq:220, end:880, dur:0.5, type:'sine', vol:0.2}); }
  fire(){
    this._noise({dur:0.12, vol:0.35, freq:1400, slide:300});
    this._blip({freq:120, end:60, dur:0.18, type:'square', vol:0.2});
  }
  rollTick(){ this._blip({freq:900, dur:0.03, type:'sine', vol:0.05}); }

  finish(){
    const seq = [523,659,784,1047];
    seq.forEach((f,i)=>this._blip({freq:f, dur:0.22, type:'triangle', vol:0.3, delay:i*0.11}));
    this._blip({freq:1319, dur:0.4, type:'sine', vol:0.22, delay:0.44});
  }
  fail(){
    this._blip({freq:300, end:120, dur:0.35, type:'sawtooth', vol:0.2});
    this._noise({dur:0.12, vol:0.2, freq:400});
  }
  pop(){ this._blip({freq:880, end:1320, dur:0.1, type:'sine', vol:0.3}); }

  // ------------- music -------------
  startMusic(){
    if(!this.ctx || this.musicTimer) return;
    const BPM = 108, stepDur = 60/BPM/2;
    // bouncy music-box loop: bass + melody (semitone offsets from root)
    const bass =   [0, null, 7, null, 5, null, 7, null];
    const melody = [12, 16, 19, 16, 17, 14, 12, 9];
    const root = 261.6; // C4
    const note = (semi, oct=0)=> root*Math.pow(2,(semi+oct*12)/12);
    this.musicStep = 0;
    this.musicTimer = setInterval(()=>{
      if(!Save.getSettings().music) return;
      const s = this.musicStep % 8;
      if(bass[s]!=null)
        this._blip({freq:note(bass[s],-1), dur:stepDur*1.6, type:'triangle', vol:0.16, dest:this.musicGain});
      if(s%1===0)
        this._blip({freq:note(melody[s]), dur:stepDur*0.9, type:'sine', vol:0.1, dest:this.musicGain});
      if(s%2===0) // soft hat
        this._noise({dur:0.03, vol:0.03, freq:6000});
      this.musicStep++;
    }, stepDur*1000);
  }

  stopMusic(){
    if(this.musicTimer){ clearInterval(this.musicTimer); this.musicTimer = null; }
  }
}

export const Sound = new AudioEngine();

export function vibrate(ms){
  if(navigator.vibrate && Save.getSettings().vibe){
    try{ navigator.vibrate(ms); }catch(e){ /* ignore */ }
  }
}
