import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {db} from '../src/server/db.ts';
import {dataDir} from '../src/server/config.ts';
import {Timeline,parseSegments,chooseSource} from './hls-timeline.mjs';
import {normalizeTransport} from './hls-transport.mjs';
const root=join(dataDir,'public-hls');
const engine=process.env.HLS_ENGINE_URL || 'http://ome:3333';
const states=new Map(); let closing=false, busy=false, ticks=0;
const atomic=async(path,text)=>{await writeFile(path+'.tmp',text);await rename(path+'.tmp',path);};
function stop(job) {
  if(!job || job.stopped)return;
  job.stopped=true;job.child.kill('SIGTERM');
  setTimeout(()=>{if(job.child.exitCode===null)job.child.kill('SIGKILL');},1500).unref();
}
async function probe(id,prefix) {
  try {
    const r=await fetch(`${engine}/live/${prefix}_${id}/llhls.m3u8`,{signal:AbortSignal.timeout(2500)});
    if(r.status===404){await r.body?.cancel();return false;}
    if(!r.ok){await r.body?.cancel();return null;}
    return (await r.text()).includes('#EXT-X-STREAM-INF:') ? true : null;
  } catch{return null;}
}
async function start(state,source) {
  const epoch=randomBytes(8).toString('hex'),dir=join(root,state.id,epoch);
  await mkdir(dir,{recursive:true});
  const input=source==='emergency'
    ? ['-re','-stream_loop','-1','-i',join(dataDir,'media','emergency.mp4')]
    : ['-rw_timeout','15000000','-live_start_index','-1','-i',`${engine}/live/${source}_${state.id}/llhls.m3u8`];
  const child=spawn('ffmpeg',['-nostdin','-v','warning',...input,
    '-map','0:v:0','-map','0:a:0','-c','copy','-bsf:v','h264_mp4toannexb',
    '-f','hls','-hls_time','2','-hls_list_size','4',
    '-hls_flags','independent_segments+temp_file',
    '-hls_segment_filename',join(dir,'seg%09d.ts'),join(dir,'index.m3u8')],{stdio:['ignore','ignore','pipe']});
  const job={source,epoch,dir,child,seen:new Set(),started:Date.now(),progress:Date.now(),closed:false,stopped:false};
  let errors=0;
  child.stderr.on('data',data=>{if(errors++<4)console.error('[public-hls]',state.id,source,String(data).replace(/session=[^\s"]+/g,'session=[redacted]').slice(0,400).trim());});
  child.on('error',()=>{job.closed=true;});child.on('close',()=>{job.closed=true;});
  return job;
}
async function segments(state,job) {
  if(!job)return [];
  try{return parseSegments(await readFile(join(job.dir,'index.m3u8'),'utf8'),`/hls/${state.id}/${job.epoch}/`);}catch{return [];}
}
async function persist(state,job,list) {
  const fresh=list.filter(s=>!job.seen.has(s.uri));
  if(!fresh.length)return;
  for(const s of fresh) {
    const path=join(job.dir,s.file);
    const buffer=await readFile(path);
    normalizeTransport(buffer,state.timeline.transport,job.epoch);
    await atomic(path,buffer);
    job.seen.add(s.uri);
  }
  if(job.seen.size>256)job.seen=new Set([...job.seen].slice(-128));
  job.progress=Date.now();
  if(state.timeline.append(job.epoch,fresh)) {
    await atomic(join(root,state.id,'state.json'),JSON.stringify(state.timeline));
    await atomic(join(root,state.id,'index.m3u8'),state.timeline.render());
  }
}
async function update(state,channel) {
  const now=Date.now();
  if(now-state.probed>2000) {
    const mark=JSON.parse(channel.watermark||'{}').enabled;
    const [raw,marked,auto]=await Promise.all([probe(state.id,'in'),mark?probe(state.id,'marked'):true,probe(state.id,'auto')]);
    const decision=chooseSource(state.desired,raw,marked,auto,mark,state.missingSince,now);
    state.desired=decision.source;state.missingSince=decision.missingSince;state.probed=now;
  }
  if(state.pending && (state.pending.source!==state.desired || state.pending.closed || now-state.pending.started>45000)) {
    stop(state.pending);state.pending=null;state.retryAt=now+2000;
  }
  const stalled=state.active && (state.active.closed || now-state.active.progress>30000);
  if(!state.pending && now>=state.retryAt && (!state.active || stalled || state.active.source!==state.desired))
    state.pending=await start(state,state.desired);
  const ready=await segments(state,state.pending);
  if(state.pending && ready.length>=1) {
    // Publish only complete keyframe-aligned segments of the chosen input.
    // Never append another segment from the previous generation after commit.
    const previous=state.active;state.active=state.pending;state.pending=null;
    for(const segment of ready.slice(0,-1))state.active.seen.add(segment.uri);
    await persist(state,state.active,ready.slice(-1));stop(previous);
    console.log('[public-hls] source',state.id,state.active.source);
  }
  if(state.active)await persist(state,state.active,await segments(state,state.active));
}
async function clean(state) {
  for(const entry of await readdir(join(root,state.id),{withFileTypes:true})) {
    if(!entry.isDirectory() || !/^[a-f0-9]{16}$/.test(entry.name))continue;
    const dir=join(root,state.id,entry.name);
    if(entry.name!==state.active?.epoch && entry.name!==state.pending?.epoch) {
      if(Date.now()-(await stat(dir)).mtimeMs>300000)await rm(dir,{recursive:true,force:true});
    } else {
      for(const file of await readdir(dir))if(/^seg\d+\.ts$/.test(file)) {
        const path=join(dir,file);if(Date.now()-(await stat(path)).mtimeMs>300000)await unlink(path).catch(()=>{});
      }
    }
  }
}
async function reconcile() {
  if(busy||closing)return;busy=true;
  try {
    const channels=db.prepare('SELECT id,watermark FROM channels WHERE enabled=1').all();
    const enabled=new Set(channels.map(c=>c.id));
    for(const [id,state] of states)if(!enabled.has(id)){stop(state.active);stop(state.pending);states.delete(id);}
    await Promise.all(channels.map(async channel=>{
      let state=states.get(channel.id);
      if(!state) {
        await mkdir(join(root,channel.id),{recursive:true});
        let saved;try{saved=JSON.parse(await readFile(join(root,channel.id,'state.json'),'utf8'));}catch{}
        const shortGop=!!JSON.parse(channel.watermark||'{}').enabled;
        state={id:channel.id,timeline:new Timeline(saved,shortGop?4:12),active:null,pending:null,desired:null,probed:0,missingSince:null,retryAt:0};states.set(channel.id,state);
        if(saved){await atomic(join(root,channel.id,'state.json'),JSON.stringify(state.timeline));await atomic(join(root,channel.id,'index.m3u8'),state.timeline.render());}
      }
      try{await update(state,channel);if(ticks%60===0)await clean(state);}catch(error){console.error('[public-hls] update failed',channel.id,error.code||error.name);}
    }));
    if(ticks%60===0)for(const entry of await readdir(root,{withFileTypes:true})) {
      if(entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name) && !states.has(entry.name)) {
        const dir=join(root,entry.name);
        if(Date.now()-(await stat(dir)).mtimeMs>300000)await rm(dir,{recursive:true,force:true});
      }
    }
    ticks++;
  } finally {busy=false;}
}
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/health'){res.writeHead(200);res.end('ok');return;}
  const master=/^\/live\/([a-f0-9]{16})\/llhls.m3u8$/.exec(path);
  const segment=/^\/hls\/([a-f0-9]{16})\/([a-f0-9]{16})\/(seg\d{9}\.ts)$/.exec(path);
  const id=master?.[1]||segment?.[1];
  if(!['GET','HEAD','OPTIONS'].includes(req.method)||!id||!states.has(id)){res.writeHead(404);res.end();return;}
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const file=master?join(root,id,'index.m3u8'):join(root,id,segment[2],segment[3]);
  try {
    const info=await stat(file);
    res.setHeader('Content-Type',master?'application/vnd.apple.mpegurl':'video/mp2t');
    res.setHeader('Cache-Control',master?'no-store, no-cache, must-revalidate':'public, max-age=300, immutable');
    res.setHeader('Connection','close');res.setHeader('Content-Length',info.size);res.setHeader('X-Content-Type-Options','nosniff');
    if(master)res.setHeader('X-OpenBroadcast-Source',states.get(id).active?.source||'starting');
    res.writeHead(200);
    if(req.method==='HEAD'){res.end();return;}
    const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  }catch{res.setHeader('Cache-Control','no-store');res.writeHead(master?503:404);res.end();}
});
await mkdir(root,{recursive:true});
server.listen(Number(process.env.PORT||8090),'0.0.0.0');
const timer=setInterval(()=>void reconcile().catch(()=>console.error('[public-hls] reconciliation failed')),1000);
void reconcile();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{closing=true;clearInterval(timer);for(const s of states.values()){stop(s.active);stop(s.pending);}server.close();setTimeout(()=>process.exit(0),2000).unref();});
