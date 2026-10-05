import {DEFAULTS,safeParams} from './config.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
class StereoEffects {
  constructor(sr){
    this.sr=sr;this.delay=[new Float32Array(Math.ceil(sr*1.1)),new Float32Array(Math.ceil(sr*1.1))];this.di=0;this.delaySamples=sr*60/100*.75;this.echo=0;this.space=0;this.filtered=[0,0];
    this.combs=[0,1].map(c=>[.0297,.0371,.0411,.0437].map((t,i)=>({data:new Float32Array(Math.round((t+c*.0013)*sr)),i:0,filter:0,feedback:.63+i*.012})));
    this.allpasses=[0,1].map(c=>[.005,.0017].map(t=>({data:new Float32Array(Math.round((t+c*.00023)*sr)),i:0})));
    this.l=0;this.r=0;
  }
  reset(){for(const d of this.delay)d.fill(0);for(const channel of this.combs)for(const c of channel){c.data.fill(0);c.filter=0;}for(const channel of this.allpasses)for(const c of channel)c.data.fill(0);this.filtered.fill(0);}
  process(l,r,params){
    this.echo+=(params.echo-this.echo)*.001;this.space+=(params.space-this.space)*.001;
    this.delaySamples+=(this.sr*60/params.tempo*.75-this.delaySamples)*.0001;
    const size=this.delay[0].length,pos=(this.di-this.delaySamples+size)%size,i=Math.floor(pos),f=pos-i;
    const dl=this.delay[0][i]*(1-f)+this.delay[0][(i+1)%size]*f,dr=this.delay[1][i]*(1-f)+this.delay[1][(i+1)%size]*f;
    this.filtered[0]+=(dr-this.filtered[0])*.24;this.filtered[1]+=(dl-this.filtered[1])*.24;
    this.delay[0][this.di]=l*.55+this.filtered[0]*.38;this.delay[1][this.di]=r*.55+this.filtered[1]*.38;this.di=(this.di+1)%size;
    for(let c=0;c<2;c++){
      const dry=c?r:l;let reverb=0;
      for(const comb of this.combs[c]){const output=comb.data[comb.i];comb.filter+=(output-comb.filter)*.35;comb.data[comb.i]=dry*.18+comb.filter*comb.feedback;comb.i=(comb.i+1)%comb.data.length;reverb+=output;}
      for(const ap of this.allpasses[c]){const delayed=ap.data[ap.i],x=reverb;reverb=delayed-x*.5;ap.data[ap.i]=x+reverb*.5;ap.i=(ap.i+1)%ap.data.length;}
      const result=dry+(c?dr:dl)*this.echo+reverb*this.space;if(c)this.r=result;else this.l=result;
    }
  }
}
export class AudioEngine {
  constructor(sampleRate=48000){
    this.sampleRate=sampleRate;this.params={...DEFAULTS};this.voices=new Map();this.controls=new Map();this.gain=DEFAULTS.volume;this.attack=DEFAULTS.attack;this.release=DEFAULTS.release;this.volume=DEFAULTS.volume;
    this.maxVoices=8;this.lastX=[0,0];this.lastY=[0,0];this.peak=0;this.frames=0;this.effects=new StereoEffects(sampleRate);this.dc=Math.exp(-2*Math.PI*20/sampleRate);this.limiter=1;
  }
  setParams(p){Object.assign(this.params,safeParams(p));for(const k of ['volume','attack','release'])this[k]=this.params[k];}
  setControl(group,bend,mod){const current=this.controls.get(group)||{bend:0,mod:0};if(Number.isFinite(bend))current.bend=clamp(bend,-2,2);if(Number.isFinite(mod))current.mod=clamp(mod,0,1);this.controls.set(group,current);}
  noteOn(id,note,velocity=.8,group='keyboard'){
    if(!Number.isFinite(note)||note<0||note>127||!Number.isFinite(velocity))return;
    const available=[...this.voices.values()].filter(v=>!v.stolen);
    if(available.length>=this.maxVoices){const victim=available.find(v=>!v.held)||available[0];victim.held=false;victim.stolen=true;}
    if(this.voices.size>=16){const victim=[...this.voices.values()].find(v=>v.stolen);if(victim)this.voices.delete(victim.id);}
    const t=new Float32Array(1024);for(let k=0;k<t.length;k++)t[k]=(1-this.params.flow)*Math.sin(k*2*Math.PI/t.length);
    const pan=.42*Math.sin((note-48)*.8),freq=440*2**((note-69)/12);
    this.voices.set(id,{id,note,group,phase:0,freq,currentFreq:freq,velocity:clamp(velocity,0,1),env:0,held:true,table:t,target:t,panL:Math.sqrt((1-pan)/2),panR:Math.sqrt((1+pan)/2)});
  }
  noteOff(id){const v=this.voices.get(id);if(v)v.held=false;}
  allOff(immediate=false){for(const v of this.voices.values()){v.held=false;if(immediate)v.stolen=true;}if(immediate){this.effects.reset();this.controls.clear();}}
  updateTable(id,table){const v=this.voices.get(id);if(v&&table?.length===1024&&table.every(Number.isFinite))v.target=table;}
  activeCount(){let n=0;for(const v of this.voices.values())if(!v.stolen)n++;return n;}
  render(left,right){
    left.fill(0);right.fill(0);const sr=this.sampleRate,smooth=1-Math.exp(-left.length/(sr*.012)),attack=1-Math.exp(-1/(this.attack*sr));
    for(const [id,v] of this.voices){
      const release=Math.exp(-1/((v.stolen?.008:this.release)*sr)),t=v.table,target=v.target,control=this.controls.get(v.group);
      const bend=control?.bend||0,mod=control?.mod||0;
      for(let k=0;k<left.length;k++){
        v.env=v.held?v.env+(1-v.env)*attack:v.env*release;
        const p=v.phase*t.length,i=p|0,f=p-i,ip=(i+1)&1023;
        const old=t[i]*(1-f)+t[ip]*f,next=target[i]*(1-f)+target[ip]*f;
        const signal=(old+(next-old)*smooth*(k+1)/left.length)*v.env*v.velocity*.19;
        left[k]+=signal*v.panL;right[k]+=signal*v.panR;
        const vib=mod*.15*Math.sin(2*Math.PI*5*(this.frames+k)/sr),freq=v.freq*2**((bend+vib)/12);
        v.currentFreq+=(freq-v.currentFreq)*.008;v.phase+=Math.min(sr*.43,v.currentFreq)/sr;v.phase-=Math.floor(v.phase);
      }
      if(t!==target)for(let k=0;k<t.length;k++)t[k]+=(target[k]-t[k])*smooth;
      if(!v.held&&v.env<.00008)this.voices.delete(id);
    }
    let peak=0;
    for(let k=0;k<left.length;k++){
      this.effects.process(left[k],right[k],this.params);this.gain+=(this.volume-this.gain)*.003;
      for(let c=0;c<2;c++){
        const x=(c?this.effects.r:this.effects.l)*this.gain,y=x-this.lastX[c]+this.dc*this.lastY[c];this.lastX[c]=x;this.lastY[c]=y;(c?right:left)[k]=y;
      }
      const samplePeak=Math.max(Math.abs(left[k]),Math.abs(right[k])),wanted=Math.min(1,.94/Math.max(1e-12,samplePeak));
      this.limiter=wanted<this.limiter?wanted:this.limiter+(wanted-this.limiter)*.0003;
      left[k]*=this.limiter;right[k]*=this.limiter;peak=Math.max(peak,Math.abs(left[k]),Math.abs(right[k]));
    }
    this.peak=peak;this.frames+=left.length;return this.activeCount();
  }
}
