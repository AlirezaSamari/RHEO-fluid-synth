import {encodeWav} from '../dist/wav.mjs';
import {Instrument} from '../dist/fluid.mjs';
import {AudioEngine} from '../dist/dsp.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const sr=48000,seconds=13,block=128,inst=new Instrument(),audio=new AudioEngine(sr),l=new Float32Array(block),r=new Float32Array(block);
const rendered=new Float32Array(sr*seconds*2);let step=0,nextStep=0,nextNote=0,note=0;
const pending=[],phrase=[60,67,64,71,62,69,65,72,60,67,64,69,59,65,62,67];
let peak=0,square=0,maxJump=0,previous=0;
for(let frame=0;frame<sr*seconds;frame+=block){
  const t=frame/sr;
  while(t>=nextNote&&nextNote<9.1){const id='demo'+note,n=phrase[note%phrase.length];inst.noteOn(id,n,.85);audio.noteOn(id,n,.85);pending.push({time:nextNote+.72,id});if(note%4===0){const b='bass'+note,bn=[48,50,48,47][Math.floor(note/4)%4];inst.noteOn(b,bn,.75);audio.noteOn(b,bn,.75);pending.push({time:nextNote+1.6,id:b});}note++;nextNote+=60/audio.params.tempo;}
  for(let i=pending.length-1;i>=0;i--)if(pending[i].time<=t){const p=pending.splice(i,1)[0];inst.noteOff(p.id);audio.noteOff(p.id);}
  while(t>=nextStep){inst.step();step++;nextStep+=1/120;if(step%4===0)for(const table of inst.tables())audio.updateTable(table.id,table.table);}
  if(t>3.2&&t<3.2+block/sr)inst.fluid.brush(.48,.5,.5,-.4);
  audio.render(l,r);
  for(let k=0;k<block&&frame+k<sr*seconds;k++){rendered[(frame+k)*2]=l[k];rendered[(frame+k)*2+1]=r[k];peak=Math.max(peak,Math.abs(l[k]),Math.abs(r[k]));square+=l[k]*l[k]+r[k]*r[k];maxJump=Math.max(maxJump,Math.abs(l[k]-previous));previous=l[k];}
}
const buffer=Buffer.from(encodeWav([rendered],sr));
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/rheo-demo.wav',buffer);const metrics={seconds,sampleRate:sr,channels:2,peak,rms:Math.sqrt(square/rendered.length),peakDb:20*Math.log10(peak),maxAdjacentJump:maxJump,notes:note};await writeFile('artifacts/audio-metrics.json',JSON.stringify(metrics,null,2));console.log(metrics);
