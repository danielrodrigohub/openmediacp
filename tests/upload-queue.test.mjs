import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(readFileSync(new URL('../src/scripts/upload-queue.ts',import.meta.url),'utf8').replace(/^import .*\n/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
class Element extends EventTarget {
 constructor(){super();this.dataset={};this.value='2';this.cells=[];this.hidden=false;this.children=[];this.classList={add(){},remove(){}};}
 setAttribute(){} close(){} append(e){this.children.push(e);} insertCell(){const c=new Element();this.cells.push(c);return c;}
 querySelector(s){return this.cells.flatMap(c=>c.children).find(e=>e.tag===s)||null;}
}
function setup(check=()=>({duplicate:false}),jobs=()=>({state:'done'})){
 const nodes=new Map(),rows=[],requests=[],timers=new Map();let next=0,uploaded=0;
 const root=new Element();root.dataset={channel:'a'.repeat(16),folder:''};root.querySelector=s=>{if(!nodes.has(s))nodes.set(s,new Element());return nodes.get(s);};
 root.querySelector('[data-queue-items]').insertRow=()=>{const row=new Element();rows.push(row);return row;};
 const doc={querySelector:()=>root,createElement:tag=>Object.assign(new Element(),{tag}),dispatchEvent:()=>uploaded++};
 class XHR{constructor(){this.upload={};this.onabort=()=>{};this.onload=()=>{};}open(){}setRequestHeader(){}send(file){this.file=file;requests.push(this);}abort(){this.onabort();}reply(status,body){this.status=status;this.responseText=JSON.stringify(body);this.onload();}}
 vm.runInNewContext(source,{document:doc,window:new Element(),Event,XMLHttpRequest:XHR,AbortSignal:{timeout:()=>undefined},fetch:async url=>({ok:true,status:200,json:async()=>url.includes('/jobs/')?jobs():check()}),setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),console});
 return {rows,requests,timers,get uploaded(){return uploaded;},add(names){const input=nodes.get('[data-files]');input.files=names.map(name=>({name,size:100}));input.dispatchEvent(new Event('change'));},run(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('429 backoff cannot start the same file twice when another upload finishes',async()=>{
 const q=setup();q.add(['a.mp4','b.mp4']);await flush();assert.equal(q.requests.length,2);
 q.requests[0].reply(429,{error:'Busy'});await flush();assert.equal(q.rows[0].dataset.state,'retrying');
 q.requests[1].reply(200,{});await flush();assert.equal(q.requests.length,2);
 q.run(2000);await flush();assert.equal(q.requests.length,3);assert.equal(q.requests[2].file.name,'a.mp4');
 q.requests[2].reply(200,{});await flush();assert.equal(q.rows[0].dataset.state,'done');
});
test('accepted upload is polled until ready without uploading its bytes again',async()=>{
 let polls=0;const q=setup(undefined,()=>++polls===1?{state:'processing'}:{state:'done',id:'asset'});
 q.add(['a.m4v']);await flush();q.requests[0].reply(202,{jobId:'job'});await flush();assert.equal(q.rows[0].dataset.state,'processing');
 q.run(2500);await flush();assert.equal(q.requests.length,1);assert.equal(q.rows[0].dataset.state,'done');assert.equal(q.uploaded,1);
});
test('a stalled transfer releases its slot and retries automatically',async()=>{
 const q=setup();q.add(['a.mp4','b.mp4','c.mp4']);await flush();q.run(120000);await flush();
 assert.equal(q.requests.length,3);assert.equal(q.requests[2].file.name,'c.mp4');
 assert.equal(q.rows[0].dataset.state,'retrying');q.requests[2].reply(200,{});await flush();q.run(2000);await flush();assert.equal(q.requests.length,5);
});

test('expired login preserves pending files instead of failing the entire batch',async()=>{
 const q=setup();q.add(['a.mp4','b.mp4','c.mp4']);await flush();q.requests[0].reply(401,{error:'Inicia sesión.'});await flush();
 q.requests[1].reply(200,{});await flush();assert.equal(q.requests.length,2);assert.equal(q.rows[0].dataset.state,'waiting');assert.equal(q.rows[2].dataset.state,'waiting');
});
