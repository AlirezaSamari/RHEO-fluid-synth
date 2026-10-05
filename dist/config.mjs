export const VERSION='1.1.0';
export const PARAMS=Object.freeze({
  viscosity:{min:0.00001,max:0.003,default:0.0003}, memory:{min:0.5,max:16,default:5},
  force:{min:0.15,max:1.6,default:0.7},flow:{min:0,max:1,default:0.85},brightness:{min:0,max:1,default:0.68},
  buoyancy:{min:0,max:2,default:0.45},heat:{min:0,max:1.5,default:0.3},diffusivity:{min:0.00001,max:0.003,default:0.0002},
  pickup:{min:0,max:2,default:0,integer:true},probeMotion:{min:0,max:1,default:1,integer:true},
  excite:{min:0,max:1,default:1,integer:true},
  attack:{min:0.005,max:0.5,default:0.045},release:{min:0.1,max:4,default:1.4},volume:{min:0,max:1,default:0.65},
  echo:{min:0,max:0.65,default:0.14},space:{min:0,max:0.7,default:0.20},tempo:{min:60,max:160,default:100}
});
export const DEFAULTS=Object.freeze(Object.fromEntries(Object.entries(PARAMS).map(([k,v])=>[k,v.default])));
export function safeParams(input={}){
  const result={};for(const [k,s] of Object.entries(PARAMS))if(Number.isFinite(input[k])){const value=Math.max(s.min,Math.min(s.max,input[k]));result[k]=s.integer?Math.round(value):value;}return result;
}
export const PRESETS=Object.freeze({
  glass:{name:'Glass current',params:{...DEFAULTS}},
  deep:{name:'Deep eddy',params:{...DEFAULTS,viscosity:.0013,memory:9,force:.9,flow:.73,brightness:.22,attack:.09,release:2.1,echo:.12,space:.35,pickup:2,buoyancy:0,heat:0}},
  silk:{name:'Silk drift',params:{...DEFAULTS,viscosity:.0023,memory:12,force:.45,flow:.9,brightness:.35,attack:.26,release:3,echo:.24,space:.45}},
  wild:{name:'Vortex grain',params:{...DEFAULTS,viscosity:.000035,memory:7,force:1.3,flow:.97,brightness:.96,attack:.01,release:.8,echo:.20,space:.12,pickup:1}},
  bells:{name:'Orbit bells',params:{...DEFAULTS,viscosity:.0001,memory:8,force:.8,flow:.93,brightness:.87,attack:.005,release:2.2,echo:.34,space:.3,tempo:120}},
  pure:{name:'Pure flow',params:{...DEFAULTS,viscosity:.00005,memory:14,force:1.1,flow:1,brightness:.8,attack:.025,release:1.6,echo:0,space:0}},
  plume:{name:'Thermal bloom',params:{...DEFAULTS,viscosity:.0004,buoyancy:1.5,heat:1.2,diffusivity:.00012,pickup:0,flow:1,memory:12,attack:.12,release:2.8,space:.3}},
  shear:{name:'Shear harmonics',params:{...DEFAULTS,viscosity:.00008,buoyancy:0,heat:0,pickup:1,probeMotion:0,flow:1,brightness:.85,echo:.08,space:.08}}
});
export function createPatch(name,params,octave=3){return {format:'rheo-patch',version:1,name:String(name||'Untitled current').trim().slice(0,48),params:{...DEFAULTS,...safeParams(params)},octave:Math.max(1,Math.min(5,Math.round(octave)))};}
export function parsePatch(input){
  const p=typeof input==='string'?JSON.parse(input):input;
  if(!p||p.format!=='rheo-patch'||p.version!==1||typeof p.name!=='string'||!p.name.trim()||p.name.length>48||!p.params||typeof p.params!=='object'||Array.isArray(p.params))throw new Error('Choose a RHEO v1 patch JSON file.');
  for(const [k,v] of Object.entries(p.params)){const s=PARAMS[k];if(!s||!Number.isFinite(v)||v<s.min||v>s.max||(s.integer&&!Number.isInteger(v)))throw new Error('Invalid patch parameter: '+k);}
  if(Object.keys(p.params).length<8)throw new Error('This patch is incomplete.');
  if(!Number.isInteger(p.octave)||p.octave<1||p.octave>5)throw new Error('Invalid patch octave.');
  return createPatch(p.name,{...p.params,...(!('heat' in p.params)?{heat:0,buoyancy:0}:{})},p.octave);
}
