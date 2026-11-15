import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {unlink} from 'node:fs/promises';
import {clipClock} from '../src/server/clip-clock.ts';
import {join} from 'node:path';
import {db} from '../src/server/db.ts';
import {dataDir} from '../src/server/config.ts';
import {writeSchedule,scheduleIsLive} from '../src/server/channels.ts';
import {channelOrder} from '../src/server/playlist.ts';
import {workerKey,overlayFilter} from '../src/server/watermark.ts';
import {shuffled,interleave,filenames} from '../src/server/playlist.ts';
const jobs=new Map(),schedules=new Map(),liveModes=new Map(),liveMissingSince=new Map();let stopping=false,reconciling=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const liveFallbackGrace=6000;
async function exclusiveLive(channel){
 if(!liveModes.has(channel.id)){
  const previous=scheduleIsLive(channel.id);liveModes.set(channel.id,previous);
  if(previous)liveMissingSince.set(channel.id,Date.now());
 }
 const name=`in_${channel.id}`;
 const ready=await fetch(`http://ome:3333/live/${name}/llhls.m3u8`,{signal:AbortSignal.timeout(1200)}).then(async r=>{const body=await r.text();return r.ok&&body.includes('#EXT-X-STREAM-INF:');}).catch(()=>false);
 if(ready){liveMissingSince.delete(channel.id);liveModes.set(channel.id,true);return true;}
 if(liveModes.get(channel.id)){
  const missingSince=liveMissingSince.get(channel.id)||Date.now();liveMissingSince.set(channel.id,missingSince);
  if(Date.now()-missingSince<liveFallbackGrace)return true;
 }
 liveMissingSince.delete(channel.id);liveModes.set(channel.id,false);return false;
}
// Recreate the public track after an encoder/profile change: OME's pass-through
// schedule otherwise retains the previous AVC initialization data.
async function refreshPublic(job,id,source='auto_'){
 await delay(10000);if(job.stopped)return;
 let ready=false;
 for(let attempt=0;attempt<30&&!job.stopped;attempt++){
  ready=await fetch(`http://ome:3333/live/${source}${id}/llhls.m3u8`,{signal:AbortSignal.timeout(2000)}).then(async r=>{const manifest=await r.text();return r.ok&&(!job.expectedResolution||manifest.includes('RESOLUTION='+job.expectedResolution));}).catch(()=>false);
  if(ready)break;await delay(1000);
 }
 if(!ready||job.stopped)return;
 await unlink(join(dataDir,'schedules',id+'.sch')).catch(()=>{});
 await delay(6500);
 const current=db.prepare('SELECT * FROM channels WHERE id=? AND enabled=1').get(id);
  if(current)writeSchedule(current,filenames(channelOrder(current),current.owner_id),liveModes.get(id)??false);
}
const streamUrl=name=>`rtmp://ome:1935/live/${name}?key=${workerKey(name)}`;
function state(id,value,asset=null,cycle=0){db.prepare('INSERT INTO playout_runtime(channel_id,state,current_asset,cycle,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET state=excluded.state,current_asset=excluded.current_asset,cycle=excluded.cycle,updated_at=excluded.updated_at').run(id,value,asset,cycle,Date.now());}
function ffmpeg(job,args,extra=false,pipeMode='normal'){const child=spawn('ffmpeg',['-nostdin','-v','error',...args],{stdio:extra?['ignore','ignore','pipe','pipe','pipe']:pipeMode==='input'?['pipe','ignore','pipe']:pipeMode==='output'?['ignore','pipe','pipe']:['ignore','ignore','pipe']});job.children.add(child);child.stderr?.on('data',data=>{if(job.errorLines<4){job.errorLines++;console.error('[playout]',String(data).replace(/key=[A-Za-z0-9_-]+/g,'key=[redacted]').slice(0,500).trim());}});child.stdin?.on('error',()=>{});child.on('error',()=>job.children.delete(child));child.once('exit',()=>job.children.delete(child));child.stdio[3]?.on('error',()=>{});child.stdio[4]?.on('error',()=>{});return child;}
function stop(job){job.stopped=true;for(const child of job.children){child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},1500).unref();}}
// Encoded media budget: 742 + 128 = 870 kbps nominal, 1072 + 128 = 1200 kbps maximum.
// Container/HTTP overhead is additional; VBV limits apply over the buffer window.
const encoding=['-c:v','libx264','-preset','superfast','-tune','zerolatency','-threads','1','-pix_fmt','yuv420p','-bf','0','-flags','+cgop','-force_key_frames','expr:gte(t,n_forced*2)','-b:v','742k','-maxrate','1072k','-bufsize','2144k','-c:a','aac','-ar','48000','-ac','2','-b:a','128k'];
// The logo changes video only. Preserve encoded OBS audio byte-for-byte.
const liveEncoding=[...encoding.slice(0,encoding.indexOf('-c:a')),'-c:a','copy'];
async function compose(job,channel){
 const mark=JSON.parse(channel.watermark),logo=db.prepare('SELECT width,height FROM logos WHERE id=?').get(mark.logo);if(!logo)throw new Error('Missing logo');
 const input='http://ome:3333/live/in_'+channel.id+'/llhls.m3u8';
 const available=()=>fetch(input,{signal:AbortSignal.timeout(1500)}).then(async response=>{await response.body?.cancel();return response.ok;}).catch(()=>false);
 while(!job.stopped){
  if(!await available()){await delay(2000);continue;}
  if(job.stopped)break;
  state(channel.id,'composing_live');
   const child=ffmpeg(job,['-rw_timeout','15000000','-live_start_index','-1','-i',input,'-i',join(dataDir,'logos',mark.logo+'.png'),'-filter_complex_threads','1','-filter_complex',overlayFilter(mark,logo.width,logo.height),'-map','[v]','-map','0:a:0',...liveEncoding,'-r',mark.frameRate==='25'?'25':'30','-shortest','-f','flv',streamUrl('marked_'+channel.id)]);
  let closed=false,unavailable=0;
  const exited=once(child,'close').catch(()=>{}).finally(()=>{closed=true;});
  while(!closed&&!job.stopped){
   await delay(2000);
   if(closed||job.stopped)break;
   unavailable=await available()?0:unavailable+1;
   if(unavailable>=2&&!closed){child.kill('SIGTERM');await Promise.race([exited,delay(1500)]);if(!closed)child.kill('SIGKILL');break;}
  }
  await exited;
  if(!job.stopped){state(channel.id,'retrying_compositor');await delay(2500);}
 }
}
async function autodjEncoded(job,channel){
 const initial=job.channel||channel;let policy=JSON.parse(initial.autodj),videos=JSON.parse(initial.fallback);if(!videos.length)videos.push('@emergency');let revision=JSON.stringify([initial.fallback,initial.autodj]),cycle=0,previousOrder=[];
 const mark=JSON.parse(channel.watermark||'{}');const logo=mark.enabled?db.prepare('SELECT width,height FROM logos WHERE id=?').get(mark.logo):null;
 const all=[...new Set([...videos,...(policy.separatorIds||[])])];const rates=[];for(const id of all){if(job.stopped)return;rates.push(await clipClock(join(dataDir,'media',fileFor(id,channel.owner_id))));}const choice=JSON.parse(channel.watermark).frameRate;const rawFps=logo?(choice==='25'?25:30):choice==='25'||choice==='30'?Number(choice):Math.min(30,Math.max(25,...rates.map(r=>r.fps)));
 const currentRevision=()=>{const current=job.channel||channel;return JSON.stringify([current.fallback,current.autodj]);};
 function refreshPlaylist(){const current=job.channel||channel,next=JSON.stringify([current.fallback,current.autodj]);if(next===revision)return false;policy=JSON.parse(current.autodj);videos=JSON.parse(current.fallback);if(!videos.length)videos.push('@emergency');revision=next;previousOrder=[];return true;}
 while(!job.stopped){
  const logoArgs=logo?['-i',join(dataDir,'logos',mark.logo+'.png'),'-filter_complex_threads','1','-filter_complex',overlayFilter(mark,logo.width,logo.height,2),'-map','[v]']:['-map','0:v:0'];
  const encoder=ffmpeg(job,['-probesize','32','-analyzeduration','0','-fpsprobesize','0','-thread_queue_size','8','-f','rawvideo','-pixel_format','yuv420p','-video_size','1280x720','-framerate',String(rawFps),'-i','pipe:3','-probesize','32','-analyzeduration','0','-thread_queue_size','128','-f','s16le','-ar','48000','-ac','2','-i','pipe:4',...logoArgs,'-map','1:a:0',...encoding,'-f','flv',streamUrl('auto_'+channel.id)],true);
  let encoderClosed=false,currentDecoder=null;encoder.once('exit',()=>{
   encoderClosed=true;currentDecoder?.kill('SIGTERM');
   // Extra stdio pipes are duplex sockets. Close their parent handles after a
   // failed encoder so child "close" events cannot wait forever for unused ends.
   for(const index of [3,4]){encoder.stdio[index]?.destroy();currentDecoder?.stdio[index]?.destroy();}
  });
   while(!job.stopped&&!encoderClosed){
    refreshPlaylist();
    let main=policy.reshuffle?shuffled(videos):policy.order?.length?[...policy.order]:[...videos];if(policy.reshuffle&&main.length>1&&main.join()===previousOrder.join())main=[...main.slice(1),main[0]];previousOrder=main;
    const order=interleave(main,policy.separatorIds||[],policy.every||0);if(!order.length)break;
    let queueChanged=false;
    for(const id of order){if(job.stopped||encoderClosed)break;if(currentRevision()!==revision){refreshPlaylist();queueChanged=true;break;}const filename=fileFor(id,channel.owner_id),clipSeconds=Math.max(1/rawFps,Math.floor((await clipClock(join(dataDir,'media',filename))).duration*rawFps)/rawFps);state(channel.id,'autodj_encoded',id,cycle);
     const decoder=ffmpeg(job,['-filter_threads','1','-re','-threads','2','-i',join(dataDir,'media',filename),'-map','0:v:0','-an','-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1','-r',String(rawFps),'-pix_fmt','yuv420p','-t',String(clipSeconds),'-f','rawvideo','pipe:3','-map','0:a:0','-vn','-af','apad','-ar','48000','-ac','2','-t',String(clipSeconds),'-f','s16le','pipe:4'],true);
     currentDecoder=decoder;for(const index of [3,4]){const output=decoder.stdio[index];output.once('end',()=>output.destroy());output.pipe(encoder.stdio[index],{end:false});}
     const [code]=await once(decoder,'close').catch(()=>[-1]);currentDecoder=null;if(code!==0&&!job.stopped){state(channel.id,'file_error',id,cycle);await delay(1000);}if(currentRevision()!==revision){refreshPlaylist();queueChanged=true;break;}
    }if(queueChanged)continue;if(!job.stopped&&!encoderClosed)cycle++;
  }
  encoder.kill('SIGTERM');if(!job.stopped)await delay(2500);
 }
}
function fileFor(id,owner){return id==='@emergency'?'emergency.mp4':filenames([id],owner)[0];}
async function autodj(job,channel){
 if(JSON.parse(channel.watermark||'{}').enabled)return autodjEncoded(job,channel);
 const clocks=new Map();let signature,playlistRevision='',policy,videos,cycle=0,previous=[];
 async function refreshPlaylist(){
  const current=job.channel||channel,nextRevision=JSON.stringify([current.fallback,current.autodj]);if(nextRevision===playlistRevision)return {changed:false,mixed:false};
  const nextPolicy=JSON.parse(current.autodj),nextVideos=JSON.parse(current.fallback),ids=[...new Set([...nextVideos,...(nextPolicy.separatorIds||[])])];let mixed=false;
  for(const id of ids){if(clocks.has(id))continue;const [filename]=filenames([id],channel.owner_id);const clock=await clipClock(join(dataDir,'media',filename));clocks.set(id,clock);if(signature&&clock.signature!==signature)mixed=true;signature??=clock.signature;}
  policy=nextPolicy;videos=nextVideos;playlistRevision=nextRevision;previous=[];return {changed:true,mixed};
 }
 const initial=await refreshPlaylist();if(initial.mixed){console.log('[playout] mixed formats: use normalized fallback',channel.id);return autodjEncoded(job,job.channel||channel);}
 while(!job.stopped){
  const mux=ffmpeg(job,['-copyts','-probesize','1000000','-analyzeduration','1000000','-f','mpegts','-i','pipe:0','-map','0:v:0','-map','0:a:0','-c','copy','-bsf:a','aac_adtstoasc','-flvflags','no_duration_filesize','-f','flv',streamUrl('auto_'+channel.id)],false,'input');
  let closed=false,current=null,timeline=1;mux.once('close',()=>{closed=true;current?.kill('SIGTERM');});
  let switchToEncoded=false;
  while(!job.stopped&&!closed){const update=await refreshPlaylist();if(update.mixed){switchToEncoded=true;break;}if(!videos.length)break;let main=shuffled(videos);if(main.length>1&&main.join()===previous.join())main=[...main.slice(1),main[0]];previous=main;
    const order=interleave(main,policy.separatorIds||[],policy.every||0);
    let queueChanged=false;
    for(const id of order){if(job.stopped||closed)break;const before=await refreshPlaylist();if(before.mixed){switchToEncoded=true;break;}if(before.changed){queueChanged=true;break;}const [file]=filenames([id],channel.owner_id);const clock=clocks.get(id);state(channel.id,'autodj_copy',id,cycle);
     const child=ffmpeg(job,['-re','-copyts','-i',join(dataDir,'media',file),'-map','0:v:0','-map','0:a:0','-c','copy','-bsf:v','h264_mp4toannexb','-mpegts_copyts','1','-mpegts_flags','+resend_headers+initial_discontinuity','-muxdelay','0','-muxpreload','0','-output_ts_offset',String(timeline-clock.start),'-f','mpegts','pipe:1'],false,'output');current=child;child.stdout.pipe(mux.stdin,{end:false});const [code]=await once(child,'close').catch(()=>[-1]);current=null;
     timeline+=clock.end-clock.start+0.001;if(code!==0&&!job.stopped&&!closed){state(channel.id,'file_error',id,cycle);await delay(1000);}const after=await refreshPlaylist();if(after.mixed){switchToEncoded=true;break;}if(after.changed){queueChanged=true;break;}
    }if(switchToEncoded)break;if(queueChanged)continue;if(!job.stopped&&!closed)cycle++;
  }mux.kill('SIGTERM');if(!closed)await once(mux,'close').catch(()=>{});if(switchToEncoded)return autodjEncoded(job,job.channel||channel);if(!job.stopped)await delay(2000);
 }
}
async function reconcile(){
 if(stopping||reconciling)return;reconciling=true;
 try{
 const channels=db.prepare('SELECT * FROM channels WHERE enabled=1').all(),wanted=new Set();
 const activeChannels=new Set(channels.map(channel=>channel.id));
 for(const id of schedules.keys())if(!activeChannels.has(id)){schedules.delete(id);liveModes.delete(id);liveMissingSince.delete(id);}
 const live=await Promise.all(channels.map(async channel=>[channel,await exclusiveLive(channel)]));
  for(const [channel,liveAvailable] of live){const scheduleSignature=JSON.stringify([channel.fallback,channel.autodj,channel.watermark,liveAvailable]);if(schedules.get(channel.id)!==scheduleSignature){writeSchedule(channel,filenames(channelOrder(channel),channel.owner_id),liveAvailable);schedules.set(channel.id,scheduleSignature);}for(const [kind,enabled,run] of [['logo',JSON.parse(channel.watermark).enabled,compose],['auto',JSON.parse(channel.watermark).enabled||JSON.parse(channel.fallback).length>0,autodj]]){
    if(!enabled)continue;const key=kind+channel.id;wanted.add(key);const signature=JSON.stringify([channel.watermark]);const previous=jobs.get(key);if(previous?.signature===signature){previous.channel=channel;continue;}if(previous)stop(previous);
    const job={signature,channel,stopped:false,children:new Set(),errorLines:0,expectedResolution:JSON.parse(channel.watermark).enabled?'1280x720':null};jobs.set(key,job);if(kind==='auto')void refreshPublic(job,channel.id).catch(()=>console.error('Public profile refresh failed.'));void run(job,channel).catch(()=>state(channel.id,'worker_error')).finally(()=>{if(jobs.get(key)===job)jobs.delete(key);});
  }}
 for(const [key,job] of jobs)if(!wanted.has(key)){stop(job);jobs.delete(key);}
 }finally{reconciling=false;}
}
const timer=setInterval(()=>{try{void reconcile().catch(()=>console.error('Playout reconciliation failed.'));}catch{console.error('Playout reconciliation failed.');}},2000);void reconcile().catch(()=>console.error('Playout initialization failed.'));
for(const signal of ['SIGTERM','SIGINT'])globalThis.process.on(signal,()=>{stopping=true;clearInterval(timer);for(const job of jobs.values())stop(job);setTimeout(()=>globalThis.process.exit(0),2000);});
