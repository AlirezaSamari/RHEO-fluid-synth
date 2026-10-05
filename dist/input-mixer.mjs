// Hardware capture stays independent of software monitoring and recording source.
export class InputMixer {
  constructor(){this.config={gain:1,monitor:false,channel:'left',recordSource:'mix'};this.gain=1;this.monitorGain=0;this.recordL=new Float32Array(128);this.recordR=new Float32Array(128);this.inputPeak=0;this.clipped=false;this.channels=0;}
  setConfig(p){if(Number.isFinite(p.gain))this.config.gain=Math.max(0,Math.min(2,p.gain));if(typeof p.monitor==='boolean')this.config.monitor=p.monitor;if(['left','right','stereo'].includes(p.channel))this.config.channel=p.channel;if(['mix','guitar','synth'].includes(p.recordSource))this.config.recordSource=p.recordSource;}
  process(left,right,input=[]){
    if(this.recordL.length!==left.length){this.recordL=new Float32Array(left.length);this.recordR=new Float32Array(left.length);}
    this.inputPeak=0;this.clipped=false;this.channels=input.length;
    for(let k=0;k<left.length;k++){
      const rawL=input[0]?.[k]||0,rawR=input[1]?.[k]||0,mode=this.config.channel;
      let l=mode==='right'?rawR:rawL,r=mode==='stereo'?(input[1]?rawR:rawL):l;
      if(Math.max(Math.abs(l),Math.abs(r))>=.995)this.clipped=true;
      this.gain+=(this.config.gain-this.gain)*.005;l*=this.gain;r*=this.gain;
      this.inputPeak=Math.max(this.inputPeak,Math.abs(l),Math.abs(r));
      const sl=left[k],sr=right[k],route=this.config.recordSource;
      let rl=route==='guitar'?l:route==='synth'?sl:sl+l,rr=route==='guitar'?r:route==='synth'?sr:sr+r;
      const peak=Math.max(Math.abs(rl),Math.abs(rr));if(peak>1){rl/=peak;rr/=peak;}
      this.recordL[k]=rl;this.recordR[k]=rr;
      this.monitorGain+=((this.config.monitor?1:0)-this.monitorGain)*.005;
      let ol=sl+l*this.monitorGain,or=sr+r*this.monitorGain;const outPeak=Math.max(Math.abs(ol),Math.abs(or));if(outPeak>.98){ol*=.98/outPeak;or*=.98/outPeak;}
      left[k]=ol;right[k]=or;
    }
  }
}
