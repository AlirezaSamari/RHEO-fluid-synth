import {wrap,clamp} from './fluid.mjs';
import {DEFAULTS,PRESETS,VERSION,createPatch,parsePatch} from './config.mjs';
import {PerformanceState,decodeMidi} from './performance.mjs';
import {encodeWav} from './wav.mjs';
const $=id=>document.getElementById(id),params={...DEFAULTS};
let worker=null,workerPromise=null,workerResolve=null,workerReject=null,workerTimer=null,workerReady=false;
let ctx=null,node=null,analyser=null,audioPending=null,audioFailed=false,state=null,octave=3,frozen=false;
let demoRunning=false,demoTimer=null,demoStep=0,demoEpoch=0,recording=false,recordPending=false,recordChunks=[],recordSeconds=0,recordDone=null;
let meter=0,holdLatched=false,spaceDown=false,currentName='Glass current',savedPatches=[],saveTimer=null,midiAccess=null,midiBusy=false;
let fieldView='vorticity',fieldTool='stir',fieldScale=1;
const probeLabels=['u · t','ω = ∇ × u','p'];
const probeDescriptions=['Velocity around the loop shapes each cycle of the sound.','Rotation sampled around the loop reveals fine vortical structure.','Pressure variations enforcing incompressibility shape the voice; this is not acoustic pressure.'];
const fieldDescriptions={vorticity:'Vorticity: local rotation. Orange turns clockwise; mint turns counterclockwise.',tracers:'Passive dye and tracer streaks reveal how the projected velocity transports material.',pressure:'Pressure relative to its spatial mean: orange positive, mint negative. It keeps the flow nearly incompressible.',temperature:'Temperature relative to zero: orange warm, mint cool. Buoyancy acts relative to the spatial mean.',speed:'Speed of the cell-centered velocity. Brighter regions move faster.'};
const takes=[],timers=new Set(),midiPorts=new Map();
const play=new PerformanceState(m=>{worker?.postMessage(m);sendAudio(m);},keyPaint),active=play.active;
function message(text,error=false){$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);}
function sendAudio(m){if(node&&!audioFailed)node.port.postMessage(m);}
function setAudioUI(){const on=ctx?.state==='running'&&!audioFailed;$('audioBtn').textContent=audioFailed?'↻ Restart audio':on?'◉ Audio on':'◉ '+(ctx?'Resume audio':'Enable audio');$('audioBtn').setAttribute('aria-pressed',String(on));$('audioStatus').textContent=on?(ctx.sampleRate/1000).toFixed(1)+' KHZ · LIVE':'AUDIO OFF';$('recordBtn').disabled=!on||recordPending;if(!on){meter=0;$('voiceCount').textContent='0 / 8 VOICES';}}
function timeout(p,ms,label){let t;return Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(new Error(label)),ms);})]).finally(()=>clearTimeout(t));}
async function startAudio(){
  if(audioPending)return audioPending;if(ctx?.state==='running'&&!audioFailed)return true;
  audioPending=(async()=>{
    try{
      if(audioFailed){node?.disconnect();await ctx?.close().catch(()=>{});node=null;ctx=null;audioFailed=false;}
      if(!ctx){
        const C=window.AudioContext||window.webkitAudioContext;if(!C)throw new Error('Web Audio is unavailable in this browser.');
        ctx=new C({latencyHint:'interactive'});const resume=ctx.resume();
        if(!ctx.audioWorklet)throw new Error('Open the HTTPS link or use the included localhost launcher. AudioWorklet is unavailable here.');
        await timeout(ctx.audioWorklet.addModule(new URL('./audio-worklet.mjs',import.meta.url)),8000,'Audio module could not load. Try restarting the engine.');
        node=new AudioWorkletNode(ctx,'rheo-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],channelCountMode:'max',channelInterpretation:'discrete'});
        analyser=ctx.createAnalyser();analyser.fftSize=2048;node.connect(analyser);analyser.connect(ctx.destination);
        node.port.onmessage=({data:m})=>{
          if(m.type==='meter'){meter=m.peak;$('voiceCount').textContent=m.voices+' / 8 VOICES';if(recording)recordSeconds=m.recordSeconds;}
          if(m.type==='recordChunk')recordChunks.push(m.samples);
          if(m.type==='recordEnd')finishRecording();
        };
        node.onprocessorerror=()=>{audioFailed=true;if(recording||recordPending)finishRecording();stopDemo();releaseAll();setAudioUI();message('Audio stopped unexpectedly. Click Restart audio to recover; your settings are kept.',true);};
        ctx.onstatechange=setAudioUI;worker?.postMessage({type:'sampleRate',value:ctx.sampleRate});sendAudio({type:'params',params});
        await timeout(resume,8000,'The browser paused audio. Click Enable audio again.');
      }else await timeout(ctx.resume(),8000,'The browser paused audio. Click Resume audio again.');
      setAudioUI();return ctx.state==='running';
    }catch(e){message(e.message,true);if(ctx&&!node){await ctx.close().catch(()=>{});ctx=null;}setAudioUI();return false;}
  })();try{return await audioPending;}finally{audioPending=null;}
}
function launchWorker(){
  worker?.terminate();workerReady=false;state=null;clearTimeout(workerTimer);
  workerPromise=new Promise((resolve,reject)=>{workerResolve=resolve;workerReject=reject;});workerPromise.catch(()=>{});
  try{
    worker=new Worker(new URL('./simulation-worker.mjs',import.meta.url),{type:'module'});
    worker.onmessage=({data:m})=>{
      if(m.type==='ready'){workerReady=true;clearTimeout(workerTimer);workerResolve();worker.postMessage({type:'params',params});if(ctx)worker.postMessage({type:'sampleRate',value:ctx.sampleRate});worker.postMessage({type:'vortex',x:.43,y:.43,strength:.38});worker.postMessage({type:'vortex',x:.60,y:.62,strength:-.22});}
      if(m.type==='tables')sendAudio(m);
      if(m.type==='error'){releaseAll();message('Fluid solver paused. Use Clear flow to reset. '+m.message,true);}
      if(m.type==='state'){state=m;updateFieldMetrics();$('simTime').textContent=String(Math.floor(m.time/60)).padStart(2,'0')+':'+String(Math.floor(m.time%60)).padStart(2,'0');$('cost').textContent=Math.round(m.hz)+' HZ · '+m.cost.toFixed(1)+' MS';$('energyLabel').textContent='E '+m.energy.toFixed(4);}
    };
    worker.onerror=e=>{workerReady=false;clearTimeout(workerTimer);workerReject(new Error('Fluid engine could not load.'));stopDemo();releaseAll();message('Fluid engine stopped. Use Restart engine in Engine status. '+(e.message||''),true);};
    workerTimer=setTimeout(()=>{if(!workerReady){workerReject(new Error('Fluid engine timed out.'));message('Fluid engine timed out. Use Restart engine in Engine status.',true);}},8000);
  }catch(e){workerReject(e);message('Worker support is required: '+e.message,true);}
}
$('audioBtn').onclick=async()=>{if(ctx?.state==='running'&&!audioFailed){stopDemo();releaseAll();if(recording)await stopRecording();await ctx.suspend();setAudioUI();}else await startAudio();};
function refreshControls(){
  for(const k of Object.keys(DEFAULTS)){
    const el=$(k),logarithmic=['viscosity','diffusivity'].includes(k);el.value=logarithmic?Math.log(params[k]/.00001)/Math.log(300)*100:params[k];if(el.tagName==='SELECT')continue;
    el.style.setProperty('--fill',((Number(el.value)-Number(el.min))/(Number(el.max)-Number(el.min))*100)+'%');
    $(k+'Out').textContent=logarithmic?params[k].toFixed(5):['memory','release'].includes(k)?params[k].toFixed(1)+' s':k==='attack'?Math.round(params[k]*1000)+' ms':['force','buoyancy','heat'].includes(k)?params[k].toFixed(2):k==='tempo'?Math.round(params[k])+' BPM':Math.round(params[k]*100)+'%';
  }
  $('pickupDescription').textContent=probeDescriptions[params.pickup];$('motionLabel').textContent=params.probeMotion?'LAGRANGIAN':'EULERIAN';$('bridgeSource').textContent=probeLabels[params.pickup];$('prandtlValue').textContent=(params.viscosity/params.diffusivity).toFixed(2);
}
function persistDraft(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem('rheo.v1.draft',JSON.stringify(createPatch(currentName,params,octave)));}catch{}},300);}
function syncParams(save=true){worker?.postMessage({type:'params',params});sendAudio({type:'params',params});refreshControls();if(save)persistDraft();}
for(const k of Object.keys(DEFAULTS))$(k).oninput=()=>{params[k]=['viscosity','diffusivity'].includes(k)?.00001*300**(Number($(k).value)/100):Number($(k).value);$('preset').value='custom';syncParams();};
function rebuildPresets(selected='custom'){
  const el=$('preset');el.replaceChildren();const add=(value,label)=>{const o=document.createElement('option');o.value=value;o.textContent=label;el.appendChild(o);};
  for(const [k,p] of Object.entries(PRESETS))add(k,p.name);savedPatches.forEach((p,i)=>add('user'+i,'Saved · '+p.name));add('custom','Current · '+currentName);el.value=selected;
}
function applyPatch(p,selected='custom'){stopDemo();releaseAll();Object.assign(params,p.params);octave=p.octave;currentName=p.name;buildKeys();rebuildPresets(selected);syncParams();}
$('preset').onchange=()=>{const key=$('preset').value;if(PRESETS[key])applyPatch(createPatch(PRESETS[key].name,{...PRESETS[key].params,volume:params.volume},octave),key);else if(key.startsWith('user'))applyPatch(savedPatches[Number(key.slice(4))],key);};
try{const all=JSON.parse(localStorage.getItem('rheo.v1.patches')||'[]');if(Array.isArray(all))savedPatches=all.slice(0,32).flatMap(p=>{try{return [parsePatch(p)];}catch{return [];}});const raw=localStorage.getItem('rheo.v1.draft');if(raw){const p=parsePatch(raw);Object.assign(params,p.params);octave=p.octave;currentName=p.name;}}catch{}
function savePatch(p){const index=savedPatches.findIndex(x=>x.name===p.name);if(index<0&&savedPatches.length>=32)throw new Error('32 saved sounds reached. Export a sound or replace an existing name.');if(index>=0)savedPatches[index]=p;else savedPatches.push(p);let durable=true;try{localStorage.setItem('rheo.v1.patches',JSON.stringify(savedPatches));}catch{durable=false;}return durable;}
$('savePatchBtn').onclick=()=>{$('patchName').value=currentName;$('patchError').textContent='';$('patchDialog').showModal();$('patchName').focus();};
$('cancelPatch').onclick=()=>$('patchDialog').close();
$('patchForm').onsubmit=e=>{e.preventDefault();try{const name=$('patchName').value.trim();if(!name)throw new Error('Give this sound a name.');const p=createPatch(name,params,octave),durable=savePatch(p);currentName=p.name;rebuildPresets('user'+savedPatches.findIndex(x=>x.name===p.name));persistDraft();$('patchDialog').close();message(durable?'Sound saved in this browser. Export JSON to keep a portable copy.':'Saved for this session. Browser storage is unavailable; export JSON to keep your sound.');}catch(e){$('patchError').textContent=e.message;}};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('exportPatchBtn').onclick=()=>download(new Blob([JSON.stringify(createPatch(currentName,params,octave),null,2)],{type:'application/json'}),'rheo-'+currentName.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'.json');
$('importPatchBtn').onclick=()=>$('patchFile').click();$('patchFile').onchange=async()=>{const f=$('patchFile').files[0];if(!f)return;try{if(f.size>65536)throw new Error('Choose a patch smaller than 64 KB.');const p=parsePatch(await f.text());applyPatch(p);message('Imported '+p.name+'. Use Save sound to add it to your palette.');}catch(e){message('Import failed: '+e.message,true);}finally{$('patchFile').value='';}};
const codes=['KeyA','KeyW','KeyS','KeyE','KeyD','KeyF','KeyT','KeyG','KeyY','KeyH','KeyU','KeyJ','KeyK'],names=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const blacks=new Set([1,3,6,8,10]),blackLeft={1:8.75,3:21.25,6:46.25,8:58.75,10:71.25};
function noteName(note){return names[note%12]+(Math.floor(note/12)-1);}
function keyPaint(){for(const k of $('keyboard').children){const note=12*(octave+1)+Number(k.dataset.offset);k.classList.toggle('active',play.sounding().some(v=>v.note===note));}const down=holdLatched||spaceDown;$('sustainBtn').setAttribute('aria-pressed',String(down));$('sustainBtn').classList.toggle('active',down);}
function buildKeys(){
  $('keyboard').replaceChildren();for(let i=0;i<13;i++){
    const b=document.createElement('button');b.className='key '+(blacks.has(i)?'black':'white');b.dataset.offset=i;b.setAttribute('aria-label',noteName(12*(octave+1)+i)+' · '+codes[i].slice(3));b.innerHTML='<span>'+codes[i].slice(3)+'</span>';if(blacks.has(i))b.style.left=blackLeft[i]+'%';
    b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);begin('pointer'+e.pointerId,12*(octave+1)+i,.85);};
    b.onpointerup=e=>end('pointer'+e.pointerId);b.onpointercancel=e=>end('pointer'+e.pointerId,true);b.onlostpointercapture=e=>end('pointer'+e.pointerId);
    b.onclick=e=>{if(e.detail===0){const s='accessible'+i;begin(s,12*(octave+1)+i,.85);later(()=>end(s),350);}};$('keyboard').appendChild(b);
  }$('octLabel').textContent='OCT '+octave;$('octDown').disabled=octave<=1;$('octUp').disabled=octave>=5;keyPaint();
}
async function begin(source,note,velocity=.8,group='keyboard'){
  const v=play.reserve(source,note,velocity,group);if(!v)return;
  try{const [ok]=await Promise.all([startAudio(),workerPromise]);if(!ok){play.off(source,true);return;}if(!play.commit(source,v.id))return;$('noteLabel').textContent=noteName(note)+' · '+(440*2**((note-69)/12)).toFixed(1)+' HZ';$('emptyHint').style.opacity=0;}
  catch(e){play.off(source,true);message(e.message,true);}
}
function end(source,force=false){play.off(source,force);}
function releaseAll(){holdLatched=false;spaceDown=false;play.allOff();}
function changeOctave(d){play.releaseGroup('keyboard');octave=clamp(octave+d,1,5);buildKeys();persistDraft();}
function updateSustain(){play.pedal('keyboard',holdLatched||spaceDown);}
$('sustainBtn').onclick=()=>{holdLatched=!holdLatched;updateSustain();};$('octDown').onclick=()=>changeOctave(-1);$('octUp').onclick=()=>changeOctave(1);
document.addEventListener('keydown',e=>{
  if(e.code==='Escape'){stopDemo();releaseAll();return;}
  if(document.querySelector('dialog[open]')||e.target.matches('input,select,textarea')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.repeat)return;
  if(e.code==='Space'&&!e.target.matches('button')){e.preventDefault();spaceDown=true;updateSustain();return;}
  const i=codes.indexOf(e.code);if(i>=0){e.preventDefault();begin(e.code,12*(octave+1)+i);}if(e.code==='KeyZ')changeOctave(-1);if(e.code==='KeyX')changeOctave(1);
});
document.addEventListener('keyup',e=>{if(codes.includes(e.code)){e.preventDefault();end(e.code);}if(e.code==='Space'){spaceDown=false;updateSustain();}});
window.addEventListener('blur',()=>{spaceDown=false;holdLatched=false;play.releaseGroup('keyboard');});
document.addEventListener('visibilitychange',()=>{worker?.postMessage({type:'visibility',visible:!document.hidden});if(document.hidden){stopDemo();releaseAll();if(recording)stopRecording();}});
$('panicBtn').onclick=()=>{stopDemo();releaseAll();};
function later(fn,ms){const t=setTimeout(()=>{timers.delete(t);fn();},ms);timers.add(t);}
function demoBeat(){if(!demoRunning)return;const phrase=[60,67,64,71,62,69,65,72,60,67,64,69,59,65,62,67],step=demoStep++,beat=60000/params.tempo,src='demo'+step;begin(src,phrase[step%phrase.length],.75,'demo');later(()=>end(src),beat*1.5);if(step%4===0){const s='demoBass'+step;begin(s,[48,50,48,47][Math.floor(step/4)%4],.7,'demo');later(()=>end(s),beat*3.2);}demoTimer=setTimeout(demoBeat,beat);}
async function startDemo(){const epoch=++demoEpoch;if(!await startAudio()||epoch!==demoEpoch)return;demoRunning=true;demoStep=0;$('demoBtn').textContent='Ⅱ Stop demo';$('demoBtn').classList.add('active');demoBeat();}
function stopDemo(){demoEpoch++;demoRunning=false;clearTimeout(demoTimer);for(const t of timers)clearTimeout(t);timers.clear();play.releaseGroup('demo');$('demoBtn').textContent='▷ Play demo';$('demoBtn').classList.remove('active');}
$('demoBtn').onclick=()=>{if(demoRunning)stopDemo();else startDemo();};
$('freezeBtn').onclick=()=>{frozen=!frozen;worker?.postMessage({type:'freeze',value:frozen});$('freezeBtn').setAttribute('aria-pressed',String(frozen));$('freezeBtn').textContent=frozen?'▷ Unfreeze':'Ⅱ Freeze';$('flowState').textContent=frozen?'FROZEN':'FLOWING';};
$('resetBtn').onclick=()=>{stopDemo();releaseAll();worker?.postMessage({type:'clear'});message('Flow cleared. Your sound settings are kept.');};
const experiments={
  vortex:{name:'Vortex pair',view:'vorticity',params:{viscosity:.00015,memory:12,buoyancy:0,heat:0,pickup:0,probeMotion:1},description:'Two counter-rotating vortices travel together and diffuse. Hold a note, then raise viscosity to hear the fine structure fade.'},
  shear:{name:'Shear layer',view:'vorticity',params:{viscosity:.00008,memory:16,buoyancy:0,heat:0,pickup:1,probeMotion:0},description:'Two periodic shear layers with a small velocity perturbation. Hold a note and compare a fixed probe with one that follows the flow.'},
  plume:{name:'Thermal plume',view:'temperature',params:{viscosity:.0003,memory:12,buoyancy:1.5,heat:1.2,diffusivity:.00012,pickup:0,probeMotion:1},description:'A warm patch rises through a cooler return flow. Hold a note, add Heat or Cool, and compare buoyancy at zero and above zero.'}
};
for(const [kind,experiment] of Object.entries(experiments))$(kind+'Experiment').onclick=()=>{
  stopDemo();releaseAll();frozen=false;worker?.postMessage({type:'freeze',value:false});$('freezeBtn').setAttribute('aria-pressed','false');$('freezeBtn').textContent='Ⅱ Freeze';$('flowState').textContent='FLOWING';
  Object.assign(params,experiment.params,{excite:0,flow:1,echo:0,space:0});currentName=experiment.name;rebuildPresets();syncParams();worker?.postMessage({type:'experiment',kind});
  fieldView=experiment.view;$('fieldView').value=fieldView;updateFieldMetrics();$('experimentDescription').textContent=experiment.description+' Notes are listening only, so they leave this experiment undisturbed. Enable “Excite fluid + listen” to add note impulses.';
  for(const key of Object.keys(experiments))$(key+'Experiment').setAttribute('aria-pressed',String(key===kind));$('emptyHint').style.opacity=0;message(experiment.name+' loaded. Hold a key or play the demo to listen.');
};
$('fieldView').value=fieldView;$('fieldTool').value=fieldTool;
$('fieldView').onchange=()=>{fieldView=$('fieldView').value;updateFieldMetrics();};$('fieldTool').onchange=()=>{fieldTool=$('fieldTool').value;};
function selectedProbe(){return state?.loops.findLast(p=>p.held)||state?.loops.at(-1);}
function fieldValue(k){
  if(fieldView==='vorticity'){const n=state.n,i=k%n,j=Math.floor(k/n),a=state.vorticity;return .25*(a[k]+a[(i+1)%n+j*n]+a[i+((j+1)%n)*n]+a[(i+1)%n+((j+1)%n)*n]);}if(fieldView==='pressure')return state.pressure[k];if(fieldView==='temperature')return state.temperature[k];if(fieldView==='tracers')return state.dye[k];
  const n=state.n,i=k%n,j=Math.floor(k/n);return Math.hypot((state.u[k]+state.u[(i+1)%n+j*n])*.5,(state.v[k]+state.v[i+((j+1)%n)*n])*.5);
}
function updateFieldMetrics(){
  $('fieldDescription').textContent=fieldDescriptions[fieldView];if(!state)return;const m=state.metrics;
  $('reynoldsValue').textContent=m.reynolds<100?m.reynolds.toFixed(1):Math.round(m.reynolds).toLocaleString();$('energyValue').textContent=m.energy.toFixed(5);$('enstrophyValue').textContent=m.enstrophy.toFixed(3);$('divergenceValue').textContent=m.divergence.toExponential(1);$('cflValue').textContent=m.cfl.toFixed(3);$('cflValue').classList.toggle('caution',m.cfl>1);
  let peak=0;for(let k=0;k<state.n*state.n;k++)peak=Math.max(peak,Math.abs(fieldValue(k)));fieldScale=Math.max(peak,1e-8);
  const signed=['vorticity','pressure','temperature'].includes(fieldView),format=peak<.001?peak.toExponential(1):peak.toFixed(3);
  $('fieldLegend').style.background=signed?'linear-gradient(#e8a47c,#213337,#aeedce)':'linear-gradient(#aeedce,#213337)';$('fieldMax').textContent=(signed?'+':'')+format;$('fieldMin').textContent=signed?'−'+format:'0';$('fieldRange').textContent='AUTO COLOR SCALE · '+(signed?'±':'0 … ')+format+' · DIMENSIONLESS';
  const p=selectedProbe();$('probeNote').textContent=p?noteName(p.note)+' · '+(params.probeMotion?'MOVING':'FIXED')+' LOOP · '+probeLabels[params.pickup]:'HOLD A NOTE TO INSPECT ITS PROBE';$('probeRms').textContent=p?'RMS '+p.probeRms.toExponential(2):'RMS —';$('circulationValue').textContent=p?'Circulation Γ '+p.circulation.toFixed(4):'Circulation Γ —';$('perimeterValue').textContent=p?'Loop length '+p.perimeter.toFixed(3):'Loop length —';
}
function startRecording(){recordChunks=[];recording=true;recordPending=false;recordSeconds=0;sendAudio({type:'record'});$('recordBtn').classList.add('active');message('Recording stereo output with effects. Stop when your take is ready.');}
function stopRecording(){if(!recording)return Promise.resolve();recording=false;recordPending=true;const done=new Promise(resolve=>{recordDone=resolve;});sendAudio({type:'stopRecord'});$('recordBtn').disabled=true;$('recordBtn').textContent='Saving…';return timeout(done,4000,'Recording stopped responding.').catch(()=>{finishRecording();});}
function finishRecording(){
  recording=false;recordPending=false;$('recordBtn').classList.remove('active');$('recordBtn').innerHTML='<span class="rec-dot"></span> Record';setAudioUI();
  const count=recordChunks.reduce((n,a)=>n+a.length,0);if(count&&ctx){const sr=ctx.sampleRate,buffer=encodeWav(recordChunks,sr),url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'})),name='rheo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.wav';takes.unshift({url,name,seconds:count/2/sr,sr});if(takes.length>3){const old=takes.pop();URL.revokeObjectURL(old.url);}renderTakes();message('Take ready. Listen below, then download the WAV to keep it.');}recordChunks=[];recordDone?.();recordDone=null;
}
function renderTakes(){const list=$('takesList');list.replaceChildren();$('takesPanel').hidden=!takes.length;for(const take of takes){const row=document.createElement('div');row.className='take-row';const info=document.createElement('span');info.textContent=take.seconds.toFixed(1)+' s · '+(take.sr/1000).toFixed(1)+' kHz · stereo';const player=document.createElement('audio');player.controls=true;player.preload='metadata';player.src=take.url;const link=document.createElement('a');link.href=take.url;link.download=take.name;link.className='button';link.textContent='Download WAV ↓';row.append(info,player,link);list.appendChild(row);}}
$('recordBtn').onclick=()=>{if(recording)stopRecording();else if(ctx?.state==='running'&&!recordPending)startRecording();};
setInterval(()=>{if(recording){const s=Math.floor(recordSeconds);$('recordBtn').innerHTML='<span class="rec-dot"></span> Stop · '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}},250);
function midiMessage(data,port){if(document.hidden)return;const m=decodeMidi(data);if(!m)return;const group='midi:'+port+':'+m.channel,source=group+':'+m.note;
  if(m.type==='on'){end(source,true);begin(source,m.note,m.velocity,group);}if(m.type==='off')end(source);if(m.type==='sustain')play.pedal(group,m.down);if(m.type==='allOff')play.releaseGroup(group);if(m.type==='bend')sendAudio({type:'control',group,bend:m.value});if(m.type==='mod')sendAudio({type:'control',group,mod:m.value});
}
function releasePort(id){for(let c=0;c<16;c++){const group='midi:'+id+':'+c;play.releaseGroup(group);sendAudio({type:'control',group,bend:0,mod:0});}}
function bindMidi(){const connected=new Map([...midiAccess.inputs.values()].filter(p=>p.state==='connected').map(p=>[p.id,p]));for(const [id,p] of midiPorts)if(!connected.has(id)){p.onmidimessage=null;releasePort(id);midiPorts.delete(id);}for(const [id,p] of connected){p.onmidimessage=e=>midiMessage(e.data,id);midiPorts.set(id,p);}$('midiStatus').textContent=midiPorts.size?Array.from(midiPorts.values()).map(p=>p.name||'MIDI input').join(' · '):'Connected · waiting for a keyboard';$('midiBtn').textContent='Disconnect MIDI';$('midiBtn').classList.add('active');}
$('midiBtn').onclick=async()=>{
  if(midiBusy)return;if(midiAccess){for(const [id,p] of midiPorts){p.onmidimessage=null;releasePort(id);}midiPorts.clear();midiAccess.onstatechange=null;midiAccess=null;$('midiBtn').textContent='Connect MIDI';$('midiBtn').classList.remove('active');$('midiStatus').textContent='Computer keyboard & touch ready';return;}
  if(!navigator.requestMIDIAccess){message('Web MIDI is unavailable in this browser. Computer keys and touch still work.',true);return;}
  midiBusy=true;try{if(!await startAudio())return;midiAccess=await navigator.requestMIDIAccess({sysex:false});midiAccess.onstatechange=bindMidi;bindMidi();message('MIDI enabled: velocity, sustain, ±2 semitone pitch bend, and mod-wheel vibrato.');}catch(e){message('MIDI access was not granted or is unavailable. '+e.message,true);}finally{midiBusy=false;}
};
function diagnostics(){const rows=[['Release',VERSION],['Fluid worker',workerReady?'Ready':'Starting / unavailable'],['Domain','48 × 48 · periodic · L = 1'],['Pressure solver','Conjugate gradient · max 96 iterations'],['Last pressure iterations',String(state?.metrics.pressureIterations??0)],['Divergence RMS',state?.metrics.divergence.toExponential(2)||'Waiting'],['Simulation rate',state?Math.round(state.hz)+' steps/s; target 120':'Waiting'],['Compute time',state?state.cost.toFixed(2)+' ms/step':'Waiting'],['Dropped catch-up steps',String(state?.dropped||0)],['Audio context',audioFailed?'Error':ctx?.state||'Not enabled'],['Sample rate',ctx?ctx.sampleRate+' Hz':'—'],['Reported base latency',ctx?.baseLatency!=null?(ctx.baseLatency*1000).toFixed(1)+' ms':'Unavailable'],['MIDI inputs',String(midiPorts.size)]];const box=$('diagnosticRows');box.replaceChildren();for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;box.append(dt,dd);}}
$('statusBtn').onclick=()=>{diagnostics();$('statusDialog').showModal();};$('closeStatus').onclick=()=>$('statusDialog').close();
$('restartBtn').onclick=async()=>{stopDemo();releaseAll();if(recording)await stopRecording();node?.disconnect();await ctx?.close().catch(()=>{});ctx=null;node=null;audioFailed=false;frozen=false;$('freezeBtn').setAttribute('aria-pressed','false');$('freezeBtn').textContent='Ⅱ Freeze';$('flowState').textContent='FLOWING';launchWorker();setAudioUI();$('statusDialog').close();message('Engine reset. Enable audio to continue with your current sound.');};
$('guideBtn').onclick=$('aboutBtn').onclick=()=>$('guide').showModal();$('closeGuide').onclick=()=>$('guide').close();
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
rebuildPresets();buildKeys();refreshControls();launchWorker();

// The visualization samples the same velocity field that deforms audio pickups.
const canvas=$('field'),g=canvas.getContext('2d'),scope=$('scope'),sg=scope.getContext('2d');
const probeCanvas=$('probeScope'),pg=probeCanvas.getContext('2d'),harmonicCanvas=$('harmonicScope'),hg=harmonicCanvas.getContext('2d');
let width=800,height=500,dpr=1,lastTime=performance.now(),pointer=null;
const particles=Array.from({length:1800},(_,i)=>({x:wrap(Math.sin(i*127.1)*43758.5453),y:wrap(Math.sin(i*311.7+10)*23421.631),age:(i%100)/100}));
const off=document.createElement('canvas');off.width=48;off.height=48;const og=off.getContext('2d'),pixels=og.createImageData(48,48);const scopeData=new Float32Array(2048);
function resize(){const r=canvas.getBoundingClientRect();dpr=Math.min(window.devicePixelRatio||1,2);width=r.width;height=r.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);g.setTransform(dpr,0,0,dpr,0,0);for(const [c,context] of [[scope,sg],[probeCanvas,pg],[harmonicCanvas,hg]]){const s=c.getBoundingClientRect();c.width=Math.round(s.width*dpr);c.height=Math.round(s.height*dpr);context.setTransform(dpr,0,0,dpr,0,0);}}
new ResizeObserver(resize).observe($('fieldWrap'));new ResizeObserver(resize).observe($('scope'));
new ResizeObserver(resize).observe($('probeScope'));new ResizeObserver(resize).observe($('harmonicScope'));
function sample(a,x,y,ox,oy){const n=state.n,gx=wrap(x)*n-ox,gy=wrap(y)*n-oy,fx=Math.floor(gx),fy=Math.floor(gy),tx=gx-fx,ty=gy-fy,i=(fx+n)%n,j=(fy+n)%n;return (a[i+j*n]*(1-tx)+a[(i+1)%n+j*n]*tx)*(1-ty)+(a[i+((j+1)%n)*n]*(1-tx)+a[(i+1)%n+((j+1)%n)*n]*tx)*ty;}
function draw(t){
  const dt=Math.min((t-lastTime)/1000,0.04);lastTime=t;
  g.fillStyle='#101b20';g.fillRect(0,0,width,height);
  const glow=g.createRadialGradient(width*.48,height*.45,0,width*.5,height*.5,width*.64);glow.addColorStop(0,'#183438');glow.addColorStop(1,'#101b20');g.fillStyle=glow;g.fillRect(0,0,width,height);
  if(state){
    const n=state.n,signed=['vorticity','pressure','temperature'].includes(fieldView);
    for(let k=0;k<n*n;k++){
      const value=fieldValue(k),normalized=clamp(value/fieldScale,-1,1),p=k*4,magnitude=Math.abs(normalized);
      const positive=signed&&value>0;
      pixels.data[p]=positive?235:105;pixels.data[p+1]=positive?157:220;pixels.data[p+2]=positive?107:202;pixels.data[p+3]=Math.round(180*Math.sqrt(magnitude));
    }
    og.putImageData(pixels,0,0);g.imageSmoothingEnabled=true;g.drawImage(off,0,0,width,height);
  }
  g.fillStyle='#6b9a9c22';for(let x=26;x<width;x+=27)for(let y=26;y<height;y+=27){g.beginPath();g.arc(x,y,.6,0,Math.PI*2);g.fill();}
  if(state){
    g.lineWidth=.75;
    for(const p of particles){
      const vx=sample(state.u,p.x,p.y,0,.5),vy=sample(state.v,p.x,p.y,.5,0),speed=Math.hypot(vx,vy);
      const oldX=p.x,oldY=p.y;if(!frozen){p.x=wrap(p.x+vx*dt);p.y=wrap(p.y+vy*dt);p.age+=dt*(.12+speed*.4);}
      if(p.age>1){p.x=Math.random();p.y=Math.random();p.age=0;}
      const opacity=Math.min(.75,.12+speed*1.5)*Math.sin(Math.PI*p.age);
      g.strokeStyle=`rgba(152,219,201,${opacity})`;g.fillStyle=g.strokeStyle;
      if(Math.abs(oldX-p.x)<.2&&Math.abs(oldY-p.y)<.2&&speed>.012){g.beginPath();g.moveTo(oldX*width,oldY*height);g.lineTo((p.x+vx*.018)*width,(p.y+vy*.018)*height);g.stroke();}
      else {g.fillRect(p.x*width,p.y*height,1.1,1.1);}
    }
    const colors=['#b7f6d4','#e8ad89','#87c5d4','#d4c394'];
    state.loops.forEach((loop,index)=>{
      const color=colors[index%4];g.strokeStyle=color;g.globalAlpha=loop.held ? .85 : Math.max(.04,.6*Math.exp(-loop.releaseAge/Math.max(.1,params.release)));g.lineWidth=1.35;
      g.beginPath();let prevX=null,prevY=null;
      for(let k=0;k<=loop.x.length;k++){const x=wrap(loop.x[k%loop.x.length])*width,y=wrap(loop.y[k%loop.y.length])*height;if(prevX===null||Math.abs(x-prevX)>width/2||Math.abs(y-prevY)>height/2)g.moveTo(x,y);else g.lineTo(x,y);prevX=x;prevY=y;}g.stroke();
      const x=wrap(loop.x[0])*width,y=wrap(loop.y[0])*height;g.fillStyle=color;g.beginPath();g.arc(x,y,2.5,0,Math.PI*2);g.fill();g.font='9px ui-monospace,monospace';g.fillText(noteName(loop.note),x+8,y-7);g.globalAlpha=1;
    });
  }
  if(pointer){g.strokeStyle='#b7f6d480';g.lineWidth=1;g.beginPath();g.arc(pointer.x*width,pointer.y*height,24,0,Math.PI*2);g.stroke();}
  drawScope();drawProbe();$('meterFill').style.width=Math.min(100,meter*250)+'%';requestAnimationFrame(draw);
}
function drawProbe(){
  const p=selectedProbe(),w=probeCanvas.width/dpr,h=probeCanvas.height/dpr,hw=harmonicCanvas.width/dpr,hh=harmonicCanvas.height/dpr;
  pg.clearRect(0,0,w,h);hg.clearRect(0,0,hw,hh);pg.strokeStyle='#304247';pg.lineWidth=.7;pg.beginPath();pg.moveTo(0,h/2);pg.lineTo(w,h/2);pg.stroke();
  hg.fillStyle='#263b40';for(let i=0;i<32;i++)hg.fillRect(i*hw/32,hh-2,Math.max(1,hw/32-3),2);
  if(!p)return;
  const peak=Math.max(1e-8,...p.q.map(Math.abs));pg.strokeStyle='#aeedce';pg.lineWidth=1.5;pg.beginPath();
  for(let i=0;i<=p.q.length;i++){const x=i/p.q.length*w,y=h/2-p.q[i%p.q.length]/peak*h*.42;if(i===0)pg.moveTo(x,y);else pg.lineTo(x,y);}pg.stroke();
  const max=Math.max(1e-8,...p.harmonics);hg.fillStyle='#e8a47c';for(let i=0;i<32;i++){const bar=p.harmonics[i]/max*(hh-9);hg.fillRect(i*hw/32,hh-bar,Math.max(1,hw/32-3),bar);}
}
function drawScope(){const w=scope.width/dpr,h=scope.height/dpr;sg.clearRect(0,0,w,h);sg.strokeStyle='#304247';sg.lineWidth=.5;sg.beginPath();sg.moveTo(0,h/2);sg.lineTo(w,h/2);sg.stroke();if(analyser&&ctx?.state==='running'&&!audioFailed)analyser.getFloatTimeDomainData(scopeData);else scopeData.fill(0);sg.strokeStyle='#ace8cd';sg.lineWidth=1.15;sg.beginPath();for(let i=0;i<w;i++){const v=scopeData[Math.floor(i/w*scopeData.length)]||0;const y=h/2-v*h*2;if(i===0)sg.moveTo(i,y);else sg.lineTo(i,y);}sg.stroke();}
function point(e){const r=canvas.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width,0,.9999),y:clamp((e.clientY-r.top)/r.height,0,.9999)};}
canvas.onpointerdown=e=>{canvas.focus();canvas.setPointerCapture(e.pointerId);pointer={...point(e),id:e.pointerId};$('emptyHint').style.opacity=0;if(fieldTool==='stir')worker?.postMessage({type:'vortex',x:pointer.x,y:pointer.y,strength:params.force*.3});else worker?.postMessage({type:'heat',x:pointer.x,y:pointer.y,amount:fieldTool==='heat'?.6:-.6});};
canvas.onpointermove=e=>{if(!pointer||pointer.id!==e.pointerId)return;const p=point(e);if(fieldTool==='stir')worker?.postMessage({type:'brush',x:p.x,y:p.y,vx:(p.x-pointer.x)*14*params.force,vy:(p.y-pointer.y)*14*params.force});else worker?.postMessage({type:'heat',x:p.x,y:p.y,amount:fieldTool==='heat'?.08:-.08});pointer={...p,id:e.pointerId};};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{pointer=null;};
requestAnimationFrame(draw);
