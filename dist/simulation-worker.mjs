import {Instrument} from './fluid.mjs';
import {FixedClock} from './performance.mjs';
const instrument=new Instrument(48),clock=new FixedClock();let running=true,totalMs=0,steps=0,windowSteps=0,last=performance.now(),lastPost=last,lastReport=last,hz=0,brush=null,failed=false;
self.onmessage=({data:m})=>{
  if(m.type==='noteOn')instrument.noteOn(m.id,m.note,m.velocity);
  if(m.type==='noteOff')instrument.noteOff(m.id);
  if(m.type==='panic')for(const p of instrument.pickups.values())p.held=false;
  if(m.type==='params')instrument.setParams(m.params);
  if(m.type==='sampleRate'&&Number.isFinite(m.value))instrument.sampleRate=m.value;
  if(m.type==='brush')brush=m;
  if(m.type==='heat'&&[m.x,m.y,m.amount].every(Number.isFinite))instrument.fluid.heat(m.x,m.y,m.amount);
  if(m.type==='experiment'&&['vortex','shear','plume'].includes(m.kind)){instrument.clear();instrument.fluid.experiment(m.kind);failed=false;clock.reset();brush=null;}
  if(m.type==='vortex'&&[m.x,m.y,m.strength].every(Number.isFinite))instrument.fluid.vortex(m.x,m.y,m.strength);
  if(m.type==='freeze')instrument.frozen=m.value;
  if(m.type==='clear'){instrument.clear();failed=false;clock.reset();brush=null;}
  if(m.type==='visibility'){running=m.visible;last=performance.now();lastReport=last;windowSteps=0;clock.reset();}
};
function tick(){
  const now=performance.now(),elapsed=(now-last)/1000;last=now;
  if(!running||failed)return;
  try{
    if(brush){const b=brush;brush=null;if([b.x,b.y,b.vx,b.vy].every(Number.isFinite))instrument.fluid.brush(b.x,b.y,b.vx,b.vy);}
    const start=performance.now(),count=clock.advance(elapsed,dt=>instrument.step(dt));totalMs+=performance.now()-start;steps+=count;windowSteps+=count;
    if(now-lastReport>=1000){hz=windowSteps*1000/(now-lastReport);windowSteps=0;lastReport=now;}
    if(now-lastPost>=1000/30){
      lastPost=now;const tables=instrument.tables();self.postMessage({type:'tables',tables},tables.map(t=>t.table.buffer));
      const f=instrument.fluid,metrics=f.diagnostics();if(!Number.isFinite(metrics.energy))throw new Error('Non-finite fluid state');
      const state={type:'state',u:f.u.slice(),v:f.v.slice(),dye:f.dye.slice(),temperature:f.temperature.slice(),pressure:f.p.slice(),vorticity:f.omega.slice(),n:f.n,time:f.time,energy:metrics.energy,metrics,cost:totalMs/Math.max(1,steps),hz,dropped:clock.dropped,loops:[...instrument.pickups.values()].map(p=>({id:p.id,note:p.note,held:p.held,releaseAge:p.releaseAge,x:p.x.slice(),y:p.y.slice(),q:p.q.slice(),harmonics:p.harmonics.slice(),circulation:p.circulation,perimeter:p.perimeter,probeRms:p.probeRms}))};
      self.postMessage(state,[state.u.buffer,state.v.buffer,state.dye.buffer,state.temperature.buffer,state.pressure.buffer,state.vorticity.buffer,...state.loops.flatMap(p=>[p.x.buffer,p.y.buffer,p.q.buffer,p.harmonics.buffer])]);
    }
  }catch(e){failed=true;self.postMessage({type:'error',message:e.message});}
}
self.postMessage({type:'ready'});
setInterval(tick,1000/120);
