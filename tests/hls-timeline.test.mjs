import test from 'node:test';
import assert from 'node:assert/strict';
import {Timeline,parseSegments,chooseSource} from '../scripts/hls-timeline.mjs';
const seg=(n,source='auto')=>({uri:`/${source}/${n}.ts`,duration:4});
test('switches AutoDJ → OBS → AutoDJ with unique sequences and explicit decoder resets',()=>{
 const t=new Timeline({next:100});
 t.append('auto1',[seg(0),seg(1)]);t.append('live1',[seg(0,'live'),seg(1,'live')]);t.append('auto2',[seg(2),seg(3)]);
  assert.deepEqual(t.entries.map(e=>e.sequence),[102,103,104,105]);
 assert.equal(t.render().split('#EXT-X-DISCONTINUITY\n').length-1,2);
  assert.equal(t.entries[0].boundary,true);assert.equal(t.entries[2].boundary,true);
 assert.equal(t.append('auto2',[seg(3)]),false);
  const restored=new Timeline(JSON.parse(JSON.stringify(t)));restored.append('auto3',[seg(4)]);
 assert.equal(restored.entries.at(-1).sequence,106);assert.equal(restored.entries.at(-1).boundary,true);
});
test('sliding window preserves discontinuity sequence when the boundary leaves',()=>{
 const t=new Timeline({next:0});t.append('auto',[seg(0)]);t.append('live',[seg(0,'live')]);
  for(let n=1;n<=8;n++)t.append('live',[seg(n,'live')]);
  assert.equal(t.entries.length,4);assert.equal(t.discontinuity,1);
 assert.match(t.render(),/#EXT-X-DISCONTINUITY-SEQUENCE:1/);
  assert.equal(t.entries[0].sequence,6);
});
test('live has priority; a probe timeout does not alternate OBS and AutoDJ',()=>{
 assert.equal(chooseSource('auto',true,true,true,true,null,0).source,'marked');
 assert.equal(chooseSource('marked',null,true,true,true,null,100).source,'marked');
  assert.equal(chooseSource('marked',false,false,true,true,100,5000).source,'marked');
  assert.equal(chooseSource('marked',false,false,true,true,100,6100).source,'auto');
  assert.equal(chooseSource('marked',true,false,true,true,null,0).source,'auto');
  assert.equal(chooseSource('emergency',true,false,true,true,null,0).source,'auto');
  assert.equal(chooseSource('marked',true,null,true,true,null,0).source,'marked');
 assert.equal(chooseSource('auto',true,false,true,true,null,0).source,'auto');
 assert.equal(chooseSource('auto',true,true,true,false,null,0).source,'in');
});
test('publishes complete local segments only, not temp files or remote paths',()=>{
 assert.deepEqual(parseSegments('#EXTM3U\n#EXTINF:4,\nseg000000001.ts\n#EXTINF:4,\nseg000000002.ts.tmp\n#EXTINF:4,\n../../secret.ts','/hls/channel/epoch/'),[{uri:'/hls/channel/epoch/seg000000001.ts',file:'seg000000001.ts',duration:4}]);
});
import {normalizeTransport,readTimestamp,writeTimestamp} from '../scripts/hls-transport.mjs';
function ts(timestamp,cc=0){const b=Buffer.alloc(188,255);b.set([0x47,0x41,0,0x10|cc,0,0,1,0xe0,0,0,0x80,0x80,5,0x21]);writeTimestamp(b,13,timestamp);return b;}
test('new encoders cannot reset the public TS timestamps or continuity counters',()=>{
 const state={};let a=normalizeTransport(ts(126000),state,'auto');const first=readTimestamp(a,13);
 let b=normalizeTransport(ts(486000,1),state,'auto');const last=readTimestamp(b,13);
 let c=normalizeTransport(ts(126000),state,'obs');
 assert.equal(last-first,360000);assert.equal(readTimestamp(c,13)-last,9000);
 assert.equal(a[3]&15,1);assert.equal(b[3]&15,2);assert.equal(c[3]&15,3);
 const resumed=JSON.parse(JSON.stringify(state));let d=normalizeTransport(ts(126000),resumed,'auto2');assert.ok(readTimestamp(d,13)>readTimestamp(c,13));
});
test('33-bit timestamp encoding and wrap remain exact',()=>{
 for(const value of [0,1,90000,2**32+123,2**33-1,2**33+17]){const b=ts(value);assert.equal(readTimestamp(b,13),value%(2**33));}
 const state={};const a=normalizeTransport(ts(2**33-3000),state,'a');const b=normalizeTransport(ts(0),state,'a');assert.equal(readTimestamp(b,13)-readTimestamp(a,13),3000);
});
