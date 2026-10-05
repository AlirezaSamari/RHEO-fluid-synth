import {AudioEngine} from './dsp.mjs';
class RheoProcessor extends AudioWorkletProcessor {
  constructor() {
    super();this.engine=new AudioEngine(sampleRate);this.recording=false;this.recordFrames=0;this.recordBuffer=new Float32Array(16384);this.ri=0;this.meter=0;this.peakHold=0;
    this.port.onmessage=({data:m})=>{
      if(m.type==='noteOn')this.engine.noteOn(m.id,m.note,m.velocity,m.group);
      if(m.type==='noteOff')this.engine.noteOff(m.id);
      if(m.type==='params')this.engine.setParams(m.params);
      if(m.type==='control')this.engine.setControl(m.group,m.bend,m.mod);
      if(m.type==='tables')for(const t of m.tables)this.engine.updateTable(t.id,t.table);
      if(m.type==='panic')this.engine.allOff(true);
      if(m.type==='record'){this.recording=true;this.recordFrames=0;this.ri=0;}
      if(m.type==='stopRecord'){this.flush();this.recording=false;this.port.postMessage({type:'recordEnd'});}
    };
  }
  flush(){if(this.ri){const samples=this.recordBuffer.slice(0,this.ri);this.port.postMessage({type:'recordChunk',samples},[samples.buffer]);this.ri=0;}}
  process(inputs,outputs) {
    const output=outputs[0];if(output.length<2)return true;
    this.engine.render(output[0],output[1]);
    if(this.recording){
      for(let k=0;k<output[0].length;k++){this.recordBuffer[this.ri++]=output[0][k];this.recordBuffer[this.ri++]=output[1][k];if(this.ri===this.recordBuffer.length)this.flush();}
      this.recordFrames+=output[0].length;
      if(this.recordFrames>=sampleRate*120){this.flush();this.recording=false;this.port.postMessage({type:'recordEnd',auto:true});}
    }
    for(let k=0;k<output[0].length;k++)this.peakHold=Math.max(this.peakHold,Math.abs(output[0][k]),Math.abs(output[1][k]));
    if(++this.meter%24===0){this.port.postMessage({type:'meter',peak:this.peakHold,voices:this.engine.activeCount(),recordSeconds:this.recordFrames/sampleRate});this.peakHold=0;}
    return true;
  }
}
registerProcessor('rheo-audio',RheoProcessor);
