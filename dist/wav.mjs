export function encodeWav(chunks,sampleRate){
  if(!Number.isInteger(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Unsupported sample rate');
  const count=chunks.reduce((n,a)=>n+a.length,0);if(count%2)throw new Error('Incomplete stereo frame');
  const buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer),text=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  text(0,'RIFF');v.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,count*2,true);
  let o=44;for(const chunk of chunks)for(const sample of chunk){const s=Number.isFinite(sample)?Math.max(-1,Math.min(1,sample)):0;v.setInt16(o,Math.round(s*(s<0?32768:32767)),true);o+=2;}return buffer;
}
