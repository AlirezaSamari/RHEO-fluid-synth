// Shared input state: retriggers, sustain domains, async note-start cancellation.
export class PerformanceState {
  constructor(send,onChange=()=>{}){this.send=send;this.onChange=onChange;this.active=new Map();this.deferred=new Map();this.pedals=new Set();this.serial=0;}
  reserve(source,note,velocity=.8,group='keyboard'){
    if(this.active.has(source))return null;
    const v={id:'n'+(++this.serial),note,velocity,group,started:false};this.active.set(source,v);this.onChange();return v;
  }
  commit(source,id){const v=this.active.get(source);if(!v||v.id!==id)return false;v.started=true;this.send({type:'noteOn',id:v.id,note:v.note,velocity:v.velocity,group:v.group});return true;}
  off(source,force=false){const v=this.active.get(source);if(!v)return;this.active.delete(source);if(v.started){if(!force&&this.pedals.has(v.group))this.deferred.set(v.id,v);else this.send({type:'noteOff',id:v.id});}this.onChange();}
  pedal(group,down){if(down)this.pedals.add(group);else{this.pedals.delete(group);for(const [id,v] of this.deferred)if(v.group===group){this.send({type:'noteOff',id});this.deferred.delete(id);}}this.onChange();}
  releaseGroup(group){this.pedal(group,false);for(const [source,v] of this.active)if(v.group===group)this.off(source,true);}
  allOff(){this.pedals.clear();for(const s of [...this.active.keys()])this.off(s,true);for(const id of this.deferred.keys())this.send({type:'noteOff',id});this.deferred.clear();this.send({type:'panic'});this.onChange();}
  sounding(){return [...this.active.values(),...this.deferred.values()];}
}
export function decodeMidi(data){
  if(!data||data.length<2)return null;const command=data[0]&0xf0,channel=data[0]&15,a=data[1]&127,b=(data[2]||0)&127;
  if(command===0x90&&data.length===3&&b>0)return {type:'on',channel,note:a,velocity:b/127};
  if((command===0x80||command===0x90)&&data.length===3)return {type:'off',channel,note:a};
  if(command===0xe0&&data.length===3)return {type:'bend',channel,value:((a+(b<<7))-8192)/8192*2};
  if(command===0xb0&&data.length===3){if(a===64)return {type:'sustain',channel,down:b>=64};if(a===123||a===120)return {type:'allOff',channel};if(a===1)return {type:'mod',channel,value:b/127};}
  return null;
}
export class FixedClock {
  constructor(hz=120,maxSteps=4){this.dt=1/hz;this.maxSteps=maxSteps;this.accumulator=0;this.dropped=0;}
  advance(seconds,step){this.accumulator+=Math.max(0,Math.min(seconds,.25));const due=Math.floor((this.accumulator+1e-9)/this.dt),count=Math.min(due,this.maxSteps);for(let i=0;i<count;i++)step(this.dt);if(due>count)this.dropped+=due-count;this.accumulator-=due*this.dt;this.accumulator=Math.max(0,this.accumulator);return count;}
  reset(){this.accumulator=0;}
}
