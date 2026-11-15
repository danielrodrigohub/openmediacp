// Remuxing preserves codec data but each FFmpeg generation starts a fresh TS clock
// and continuity counters. Translate those fields before exposing a segment. This
// is packet-header work only: H.264/AAC payloads are never decoded or modified.
const wrap=2**33;
const modulo=n=>((n%wrap)+wrap)%wrap;
export function readTimestamp(b,p){return ((b[p]>>1)&7)*2**30+b[p+1]*2**22+(b[p+2]>>1)*2**15+b[p+3]*128+(b[p+4]>>1);}
export function writeTimestamp(b,p,t){t=modulo(t);b[p]=(b[p]&0xf0)|((Math.floor(t/2**30)&7)<<1)|1;b[p+1]=Math.floor(t/2**22)&255;b[p+2]=((Math.floor(t/2**15)&127)<<1)|1;b[p+3]=Math.floor(t/128)&255;b[p+4]=((t%128)<<1)|1;}
const near=(value,anchor)=>value+Math.round((anchor-value)/wrap)*wrap;
export function normalizeTransport(buffer,state,generation){
 if(buffer.length%188)throw Error('Incomplete TS segment');
 const pts=[],pcr=[],packets=[];
 for(let start=0;start<buffer.length;start+=188){
  if(buffer[start]!==0x47)throw Error('Invalid TS sync');
  const pid=((buffer[start+1]&31)<<8)|buffer[start+2],afc=(buffer[start+3]>>4)&3;
  if(!afc)throw Error('Invalid TS adaptation');
  packets.push({start,pid,payload:!!(afc&1)});
  let pos=start+4;
  if(afc&2){const length=buffer[pos];if(pos+1+length>start+188)throw Error('Invalid TS adaptation length');
   if(length>=7&&(buffer[pos+1]&0x10))pcr.push(pos+2);
   pos+=1+length;
  }
  if(!(afc&1)||!(buffer[start+1]&0x40)||pos+14>start+188)continue;
  if(buffer[pos]||buffer[pos+1]||buffer[pos+2]!==1)continue;
  const stream=buffer[pos+3];if(stream<0xc0||stream>0xef)continue;
  const flags=buffer[pos+7]>>6;
  if(flags===2||flags===3)pts.push(pos+9);
  if(flags===3&&pos+19<=start+188)pts.push(pos+14);
 }
 if(!pts.length)throw Error('Missing TS timestamps');
 const reference=readTimestamp(buffer,pts[0]);
 const first=Math.min(...pts.map(p=>near(readTimestamp(buffer,p),reference)));
 // Leave room for a final buffered AAC frame when sample rates change.
 state.counters??={};state.lastTime??=90000;
 if(state.generation!==generation){state.offset=state.lastTime+9000-first;state.generation=generation;state.inputAnchor=reference;}
 for(const pos of pts){const raw=near(readTimestamp(buffer,pos),state.inputAnchor);const time=raw+state.offset;writeTimestamp(buffer,pos,time);state.lastTime=Math.max(state.lastTime,time);state.inputAnchor=raw;}
 for(const p of pcr){const raw=buffer[p]*2**25+buffer[p+1]*2**17+buffer[p+2]*512+buffer[p+3]*2+(buffer[p+4]>>7);const time=modulo(raw+state.offset);
  buffer[p]=Math.floor(time/2**25)&255;buffer[p+1]=Math.floor(time/2**17)&255;buffer[p+2]=Math.floor(time/512)&255;buffer[p+3]=Math.floor(time/2)&255;buffer[p+4]=(buffer[p+4]&127)|((time%2)<<7);
 }
 for(const {start,pid,payload} of packets){if(pid===8191)continue;let cc=state.counters[pid]??0;if(payload)cc=(cc+1)&15;buffer[start+3]=(buffer[start+3]&0xf0)|cc;state.counters[pid]=cc;}
 return buffer;
}
