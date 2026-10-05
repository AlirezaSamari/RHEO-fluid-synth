// Unit periodic domain, constant reference density. y increases down the screen.
// RK2 semi-Lagrangian advection, explicit diffusion, CG pressure projection.
import {DEFAULTS,safeParams} from './config.mjs';
export {DEFAULTS} from './config.mjs';
export const wrap = x => x - Math.floor(x);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export class Fluid {
  constructor(n = 48) {
    this.n=n;this.size=n*n;this.time=0;this.lastDt=1/120;this.pressureIterations=0;
    for(const k of ['u','v','un','vn','div','dye','dn','temperature','tn','omega','psi'])this[k]=new Float32Array(this.size);
    // Double precision avoids stalling CG on the singular, periodic Poisson system.
    for(const k of ['p','residual','direction','laplacian'])this[k]=new Float64Array(this.size);
    this.params={...DEFAULTS};
  }
  sample(a,x,y,ox=.5,oy=.5){
    const n=this.n,gx=wrap(x)*n-ox,gy=wrap(y)*n-oy,fx=Math.floor(gx),fy=Math.floor(gy),tx=gx-fx,ty=gy-fy;
    const i=(fx+n)%n,j=(fy+n)%n,ip=(i+1)%n,jp=(j+1)%n;
    return (a[i+j*n]*(1-tx)+a[ip+j*n]*tx)*(1-ty)+(a[i+jp*n]*(1-tx)+a[ip+jp*n]*tx)*ty;
  }
  velocity(x,y){return [this.sample(this.u,x,y,0,.5),this.sample(this.v,x,y,.5,0)];}
  clear(){for(const k of ['u','v','un','vn','div','dye','dn','temperature','tn','omega','psi','p','residual','direction','laplacian'])this[k].fill(0);this.time=0;this.pressureIterations=0;}
  vortex(x,y,strength=.5,radius=.085){
    const n=this.n,r2=radius*radius;
    // The discrete curl of a vertex streamfunction is divergence-free on the MAC grid.
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const dx=wrap(i/n-x+.5)-.5,dy=wrap(j/n-y+.5)-.5;
      this.psi[i+j*n]=strength*radius*Math.exp(-(dx*dx+dy*dy)/(2*r2));
    }
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n;this.u[k]+=n*(this.psi[i+((j+1)%n)*n]-this.psi[k]);this.v[k]-=n*(this.psi[(i+1)%n+j*n]-this.psi[k]);
      const dx=wrap((i+.5)/n-x+.5)-.5,dy=wrap((j+.5)/n-y+.5)-.5;
      this.dye[k]=Math.min(2,this.dye[k]+.6*Math.exp(-(dx*dx+dy*dy)/(2*r2)));
    }
  }
  brush(x,y,vx,vy,radius=.055){
    const n=this.n,r2=radius*radius;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n;
      let dx=wrap(i/n-x+.5)-.5,dy=wrap((j+.5)/n-y+.5)-.5;
      this.u[k]+=clamp(vx,-.6,.6)*Math.exp(-(dx*dx+dy*dy)/(2*r2));
      dx=wrap((i+.5)/n-x+.5)-.5;dy=wrap(j/n-y+.5)-.5;
      this.v[k]+=clamp(vy,-.6,.6)*Math.exp(-(dx*dx+dy*dy)/(2*r2));
      dx=wrap((i+.5)/n-x+.5)-.5;dy=wrap((j+.5)/n-y+.5)-.5;
      this.dye[k]=Math.min(2,this.dye[k]+.35*Math.exp(-(dx*dx+dy*dy)/(2*r2)));
    }
  }
  heat(x,y,amount=.5,radius=.07){
    const n=this.n;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const dx=wrap((i+.5)/n-x+.5)-.5,dy=wrap((j+.5)/n-y+.5)-.5,k=i+j*n,w=Math.exp(-(dx*dx+dy*dy)/(2*radius*radius));
      this.temperature[k]=clamp(this.temperature[k]+amount*w,-3,3);this.dye[k]=Math.min(2,this.dye[k]+Math.abs(amount)*w*.4);
    }
  }
  divergence(){
    const n=this.n;let sum=0;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n,d=(this.u[(i+1)%n+j*n]-this.u[k]+this.v[i+((j+1)%n)*n]-this.v[k])*n;
      this.div[k]=d;sum+=d*d;
    }
    return Math.sqrt(sum/this.size);
  }
  project(dt,iterations=96){
    const n=this.n,size=this.size,p=this.p,r=this.residual,d=this.direction,ad=this.laplacian,scale=-1/(n*n*dt);
    this.divergence();p.fill(0);let mean=0;for(const value of this.div)mean+=value;mean/=size;
    let rr=0;for(let k=0;k<size;k++){r[k]=d[k]=(this.div[k]-mean)*scale;rr+=r[k]*r[k];}
    const target=Math.max(1e-24,rr*1e-12);this.pressureIterations=0;
    for(let z=0;z<iterations&&rr>target;z++){
      let dad=0;
      for(let j=0;j<n;j++)for(let i=0;i<n;i++){
        const k=i+j*n;ad[k]=4*d[k]-d[(i+1)%n+j*n]-d[(i+n-1)%n+j*n]-d[i+((j+1)%n)*n]-d[i+((j+n-1)%n)*n];dad+=d[k]*ad[k];
      }
      if(dad<=1e-30)break;
      const alpha=rr/dad;let next=0;
      for(let k=0;k<size;k++){p[k]+=alpha*d[k];r[k]-=alpha*ad[k];next+=r[k]*r[k];}
      const beta=next/rr;for(let k=0;k<size;k++)d[k]=r[k]+beta*d[k];rr=next;this.pressureIterations=z+1;
    }
    let pMean=0;for(const value of p)pMean+=value;pMean/=size;for(let k=0;k<size;k++)p[k]-=pMean;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n;this.u[k]-=dt*n*(p[k]-p[(i+n-1)%n+j*n]);this.v[k]-=dt*n*(p[k]-p[i+((j+n-1)%n)*n]);
    }
  }
  updateVorticity(){
    const n=this.n;
    // Curl lives at grid vertices, not cell centers.
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n;this.omega[k]=n*(this.v[k]-this.v[(i+n-1)%n+j*n]-this.u[k]+this.u[i+((j+n-1)%n)*n]);
    }
  }
  step(dt=1/120){
    const n=this.n,visc=this.params.viscosity*dt*n*n,thermal=this.params.diffusivity*dt*n*n;
    if(Math.max(visc,thermal)>.24)throw new Error('Diffusion time step too large');
    this.lastDt=dt;
    const decay=Math.exp(-dt/this.params.memory),cooling=Math.exp(-dt/8);
    // Boussinesq-type force relative to spatial mean: no whole-box acceleration.
    let ambient=0;for(const t of this.temperature)ambient+=t;ambient/=this.size;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n;this.v[k]-=dt*this.params.buoyancy*((this.temperature[k]+this.temperature[i+((j+n-1)%n)*n])*.5-ambient);
    }
    // Periodic advection and diffusion cannot change net momentum. Restore that
    // zero Fourier mode after interpolation; retain applied impulses and drag.
    let meanU=0,meanV=0;for(let k=0;k<this.size;k++){meanU+=this.u[k];meanV+=this.v[k];}meanU=meanU/this.size*decay;meanV=meanV/this.size*decay;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n;
      for(let c=0;c<2;c++){
        const x=(i+(c?.5:0))/n,y=(j+(c?0:.5))/n,vx=this.sample(this.u,x,y,0,.5),vy=this.sample(this.v,x,y,.5,0);
        const mx=x-.5*dt*vx,my=y-.5*dt*vy,bx=x-dt*this.sample(this.u,mx,my,0,.5),by=y-dt*this.sample(this.v,mx,my,.5,0);
        (c?this.vn:this.un)[k]=this.sample(c?this.v:this.u,bx,by,c?.5:0,c?0:.5);
      }
    }
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n;
      for(let c=0;c<2;c++){
        const src=c?this.vn:this.un,dst=c?this.v:this.u,lap=src[(i+1)%n+j*n]+src[(i+n-1)%n+j*n]+src[i+((j+1)%n)*n]+src[i+((j+n-1)%n)*n]-4*src[k];
        dst[k]=(src[k]+visc*lap)*decay;
      }
    }
    let advectedU=0,advectedV=0;for(let k=0;k<this.size;k++){advectedU+=this.u[k];advectedV+=this.v[k];}advectedU=advectedU/this.size-meanU;advectedV=advectedV/this.size-meanV;
    for(let k=0;k<this.size;k++){this.u[k]-=advectedU;this.v[k]-=advectedV;}
    this.project(dt);
    // Scalars follow the projected flow, using the same midpoint backtrace.
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n,x=(i+.5)/n,y=(j+.5)/n,vx=this.sample(this.u,x,y,0,.5),vy=this.sample(this.v,x,y,.5,0);
      const mx=x-.5*dt*vx,my=y-.5*dt*vy,bx=x-dt*this.sample(this.u,mx,my,0,.5),by=y-dt*this.sample(this.v,mx,my,.5,0);
      this.dn[k]=this.sample(this.dye,bx,by)*Math.exp(-dt/4);this.tn[k]=this.sample(this.temperature,bx,by);
    }
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n,s=this.tn,lap=s[(i+1)%n+j*n]+s[(i+n-1)%n+j*n]+s[i+((j+1)%n)*n]+s[i+((j+n-1)%n)*n]-4*s[k];this.temperature[k]=(s[k]+thermal*lap)*cooling;
    }
    [this.dye,this.dn]=[this.dn,this.dye];this.updateVorticity();this.time+=dt;
  }
  energy(){let e=0;for(let k=0;k<this.size;k++)e+=this.u[k]**2+this.v[k]**2;return e/(2*this.size);}
  diagnostics(){
    this.updateVorticity();let enstrophy=0,maxSpeed=0,cfl=0,temperature=0;
    const n=this.n;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const k=i+j*n,u=(this.u[k]+this.u[(i+1)%n+j*n])*.5,v=(this.v[k]+this.v[i+((j+1)%n)*n])*.5;
      enstrophy+=this.omega[k]**2;maxSpeed=Math.max(maxSpeed,Math.hypot(u,v));cfl=Math.max(cfl,Math.abs(u)+Math.abs(v));temperature+=this.temperature[k];
    }
    const energy=this.energy(),rmsSpeed=Math.sqrt(2*energy);
    return {energy,rmsSpeed,maxSpeed,enstrophy:enstrophy/(2*this.size),reynolds:rmsSpeed/this.params.viscosity,divergence:this.divergence(),cfl:cfl*this.lastDt*n,meanTemperature:temperature/this.size,pressureIterations:this.pressureIterations};
  }
  experiment(kind){
    this.clear();
    if(kind==='vortex'){this.vortex(.37,.5,.85,.075);this.vortex(.63,.5,-.85,.075);}
    if(kind==='shear'){
      const n=this.n;for(let j=0;j<n;j++)for(let i=0;i<n;i++){
        const k=i+j*n,y=(j+.5)/n;this.u[k]=.28*Math.tanh(Math.sin(2*Math.PI*y)/.13);this.v[k]=.018*Math.sin(4*Math.PI*(i+.5)/n);this.dye[k]=Math.exp(-((Math.sin(2*Math.PI*y)/.22)**2));
      }
    }
    if(kind==='plume')this.heat(.5,.75,1.5,.08);
    this.project(1/120);this.updateVorticity();
  }
}

export const LOOP_POINTS=96, HARMONICS=32, TABLE_SIZE=1024;
const cos=new Float32Array(HARMONICS*LOOP_POINTS), sin=new Float32Array(HARMONICS*LOOP_POINTS);
for(let h=1;h<=HARMONICS;h++) for(let k=0;k<LOOP_POINTS;k++) { const a=2*Math.PI*h*k/LOOP_POINTS;cos[(h-1)*LOOP_POINTS+k]=Math.cos(a);sin[(h-1)*LOOP_POINTS+k]=Math.sin(a); }
const tableCos=new Float32Array(HARMONICS*TABLE_SIZE),tableSin=new Float32Array(HARMONICS*TABLE_SIZE);
for(let h=1;h<=HARMONICS;h++) for(let k=0;k<TABLE_SIZE;k++) {const a=2*Math.PI*h*k/TABLE_SIZE;tableCos[(h-1)*TABLE_SIZE+k]=Math.cos(a);tableSin[(h-1)*TABLE_SIZE+k]=Math.sin(a);}

export class Pickup {
  constructor(id,note,velocity=0.8) {
    this.id=id;this.note=note;this.velocity=velocity;this.age=0;this.held=true;this.releaseAge=0;
    this.x=new Float32Array(LOOP_POINTS);this.y=new Float32Array(LOOP_POINTS);
    this.q=new Float32Array(LOOP_POINTS);this.a=new Float32Array(HARMONICS);this.b=new Float32Array(HARMONICS);
    this.cx=0.22+wrap((note-48)*0.137)*0.56;this.cy=0.32+wrap((note-48)*0.173)*0.36;
    for(let k=0;k<LOOP_POINTS;k++) {let a=2*Math.PI*k/LOOP_POINTS;this.x[k]=this.cx+0.095*Math.cos(a);this.y[k]=this.cy+0.075*Math.sin(a);}
    this.level=0;this.circulation=0;this.perimeter=0;this.probeRms=0;this.harmonics=new Float32Array(HARMONICS);
  }
  excite(fluid,strength=1) {
    fluid.vortex(this.cx+0.04,this.cy-0.028,fluid.params.force*this.velocity*strength,0.085);
    fluid.vortex(this.cx-0.055,this.cy+0.04,-fluid.params.force*this.velocity*strength*0.4,0.052);
    fluid.heat(this.cx,this.cy,fluid.params.heat*this.velocity*strength);
  }
  step(fluid,dt) {
    this.age+=dt;if(!this.held)this.releaseAge+=dt;
    if(!fluid.params.probeMotion)return;
    for(let k=0;k<LOOP_POINTS;k++) {
      const x=this.x[k],y=this.y[k], [vx,vy]=fluid.velocity(x,y);
      const [mx,my]=fluid.velocity(x+vx*dt*0.5,y+vy*dt*0.5);
      this.x[k]+=mx*dt;this.y[k]+=my*dt;
    }
    // Remesh by arc length to avoid empty stretches in the scanned curve.
    // The curve is passively advected; point labels are not material invariants.
    if(Math.floor(this.age*12)!==Math.floor((this.age-dt)*12)) this.remesh();
  }
  remesh() {
    const m=LOOP_POINTS,arc=new Float32Array(m+1);
    for(let k=0;k<m;k++)arc[k+1]=arc[k]+Math.hypot(this.x[(k+1)%m]-this.x[k],this.y[(k+1)%m]-this.y[k]);
    if(arc[m]<1e-7)return;
    const x=new Float32Array(m),y=new Float32Array(m);let j=0;
    for(let k=0;k<m;k++){const d=arc[m]*k/m;while(j<m-1&&arc[j+1]<d)j++;const t=(d-arc[j])/Math.max(1e-10,arc[j+1]-arc[j]);x[k]=this.x[j]*(1-t)+this.x[(j+1)%m]*t;y[k]=this.y[j]*(1-t)+this.y[(j+1)%m]*t;}
    this.x=x;this.y=y;
    // Recenter unwrapped coordinates by an integer to retain Float32 precision.
    const ix=Math.floor(x[0]),iy=Math.floor(y[0]);for(let k=0;k<m;k++){this.x[k]-=ix;this.y[k]-=iy;}
  }
  spectrum(fluid) {
    // Uniform arclength samples keep Fourier position tied to distance, even between remeshes.
    const arc=new Float64Array(LOOP_POINTS+1),sx=new Float64Array(LOOP_POINTS),sy=new Float64Array(LOOP_POINTS);
    for(let k=0;k<LOOP_POINTS;k++)arc[k+1]=arc[k]+Math.hypot(this.x[(k+1)%LOOP_POINTS]-this.x[k],this.y[(k+1)%LOOP_POINTS]-this.y[k]);
    this.perimeter=arc[LOOP_POINTS];let segment=0;
    for(let k=0;k<LOOP_POINTS;k++){const distance=k*this.perimeter/LOOP_POINTS;while(segment<LOOP_POINTS-1&&arc[segment+1]<distance)segment++;const t=(distance-arc[segment])/Math.max(1e-10,arc[segment+1]-arc[segment]);sx[k]=this.x[segment]*(1-t)+this.x[(segment+1)%LOOP_POINTS]*t;sy[k]=this.y[segment]*(1-t)+this.y[(segment+1)%LOOP_POINTS]*t;}
    let mean=0,peak=0,gamma=0;
    if(fluid.params.pickup===1)fluid.updateVorticity();
    for(let k=0;k<LOOP_POINTS;k++) {
      const prev=(k+LOOP_POINTS-1)%LOOP_POINTS,next=(k+1)%LOOP_POINTS;
      const tx=sx[next]-sx[prev],ty=sy[next]-sy[prev],len=Math.max(1e-8,Math.hypot(tx,ty));
      const [u,v]=fluid.velocity(sx[k],sy[k]),tangential=(u*tx+v*ty)/len;
      gamma+=tangential*this.perimeter/LOOP_POINTS;
      this.q[k]=fluid.params.pickup===1?fluid.sample(fluid.omega,sx[k],sy[k],0,0):fluid.params.pickup===2?fluid.sample(fluid.p,sx[k],sy[k]):tangential;mean+=this.q[k];
    }
    this.circulation=gamma;let square=0;
    // Fixed sonification gains compare different measured quantities; they are not physical laws.
    const gain=[1,.085,1/.7][fluid.params.pickup];
    mean/=LOOP_POINTS;for(let k=0;k<LOOP_POINTS;k++){this.q[k]-=mean;square+=this.q[k]**2;peak=Math.max(peak,Math.abs(this.q[k])*gain);}this.probeRms=Math.sqrt(square/LOOP_POINTS);
    // Bounded normalization preserves activity decay and does not amplify quiet noise.
    this.level=0.82*this.level+0.18*peak;const scale=1/Math.max(0.10,this.level);
    const tilt=0.35+(1-fluid.params.brightness)*2.8;
    for(let h=0;h<HARMONICS;h++){
      let a=0,b=0;for(let k=0;k<LOOP_POINTS;k++){a+=this.q[k]*cos[h*LOOP_POINTS+k];b+=this.q[k]*sin[h*LOOP_POINTS+k];}
      const window=Math.exp(-(((h+1)/28)**4))/Math.pow(h+1,tilt);
      this.a[h]=a*2/LOOP_POINTS*gain*scale*window;this.b[h]=b*2/LOOP_POINTS*gain*scale*window;
    }
    return {a:this.a,b:this.b};
  }
  table(fluid,maxH=HARMONICS) {
    this.spectrum(fluid);const out=new Float32Array(TABLE_SIZE);
    const blend=fluid.params.flow;
    // The small pitch anchor is an explicit synthesis design choice.
    for(let k=0;k<TABLE_SIZE;k++)out[k]=(1-blend)*tableSin[k];
    for(let h=0;h<Math.min(maxH,HARMONICS);h++)for(let k=0;k<TABLE_SIZE;k++)out[k]+=blend*(this.a[h]*tableCos[h*TABLE_SIZE+k]+this.b[h]*tableSin[h*TABLE_SIZE+k]);
    let peak=0;for(const x of out)peak=Math.max(peak,Math.abs(x));
    if(peak>1)for(let k=0;k<TABLE_SIZE;k++)out[k]/=peak;
    for(let h=0;h<HARMONICS;h++)this.harmonics[h]=h<maxH?Math.hypot(blend*this.a[h],blend*this.b[h]+(h===0?1-blend:0))/Math.max(1,peak):0;
    return out;
  }
}

export class Instrument {
  constructor(n=48) {this.fluid=new Fluid(n);this.pickups=new Map();this.maxVoices=8;this.sampleRate=48000;this.frozen=false;}
  setParams(p) {Object.assign(this.fluid.params,safeParams(p));}
  noteOn(id,note,velocity=0.8) {
    if(!Number.isFinite(note)||note<0||note>127||!Number.isFinite(velocity))return null;
    if(this.pickups.size>=this.maxVoices){const victim=[...this.pickups.values()].find(v=>!v.held)||this.pickups.values().next().value;this.pickups.delete(victim.id);}
    const p=new Pickup(id,note,velocity);this.pickups.set(id,p);if(this.fluid.params.excite)p.excite(this.fluid);return p;
  }
  noteOff(id) {const p=this.pickups.get(id);if(p)p.held=false;}
  step(dt=1/120) {
    if(this.frozen){for(const [id,p] of this.pickups){if(!p.held){p.releaseAge+=dt;if(p.releaseAge>this.fluid.params.release*9+0.2)this.pickups.delete(id);}}return;}
    this.fluid.step(dt);
    for(const [id,p] of this.pickups){p.step(this.fluid,dt);if(!p.held&&p.releaseAge>this.fluid.params.release*9+0.2)this.pickups.delete(id);}
  }
  tables() { return [...this.pickups.values()].map(p=>({id:p.id,table:p.table(this.fluid,Math.max(1,Math.min(HARMONICS,Math.floor(this.sampleRate*0.43/(440*2**((p.note+2.25-69)/12))))))})); }
  clear() {this.fluid.clear();this.pickups.clear();}
}
