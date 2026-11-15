// Integration test for folder uploads, cycle-driven AutoDJ and baked watermark.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,rm,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {db} from '../src/server/db.ts';
import {dataDir,origin,cookieName} from '../src/server/config.ts';
import {createUser,login} from '../src/server/auth.ts';
import {createChannel,setFallback} from '../src/server/channels.ts';
import {saveWatermark} from '../src/server/watermark.ts';
const run=promisify(execFile),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const nonce=randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
const userId=await createUser('features'+nonce,password,'client'),actor={id:userId,username:'features'+nonce,role:'client'};
const {channel,key}=createChannel('Prueba aislada de funciones',userId,{...actor,role:'admin'});
const dir=join(dataDir,'fixtures',nonce);await mkdir(dir,{recursive:true});
const api=process.env.OME_API_URL||'http://ome:8081',headers={Authorization:'Basic '+Buffer.from(process.env.OME_API_TOKEN).toString('base64')};
async function until(check,label,max=90){for(let i=0;i<max;i++){if(await check()){console.log(label);return;}await sleep(1000);}throw new Error(label+': timeout');}
async function streamInfo(name){try{const r=await fetch(`${api}/v1/vhosts/default/apps/live/streams/${name}`,{headers,signal:AbortSignal.timeout(1500)});return r.ok?(await r.json()).response:null;}catch{return null;}}
async function stream(name){return !!await streamInfo(name);}
let logoId='',publisher;
try{
 console.log('Feature channel:',channel.id);
 for(const [name,color] of [['one','red'],['two','green']])await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`color=c=${color}:s=320x180:r=25`,'-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-bf','0','-c:a','aac',join(dir,name+'.mp4')]);
 const session=await login(actor.username,password,'feature-test');if(!session.token)throw new Error('Test login failed');
 const results=await Promise.all(['one','two'].map(async name=>{
  const response=await fetch('http://127.0.0.1:4321/api/assets/upload',{method:'POST',headers:{origin,cookie:`${cookieName}=${session.token}`,'content-type':'application/octet-stream','x-file-name':name==='one'?'one.m4v':'two.mp4','x-folder':encodeURIComponent('carpeta/subcarpeta')},body:await readFile(join(dir,name+'.mp4'))});const body=await response.json();if(!response.ok)throw new Error('Upload failed: '+body.error);return body.id;
 }));
 if(db.prepare('SELECT count(*) AS n FROM assets WHERE owner_id=? AND folder=?').get(userId,'carpeta/subcarpeta').n!==2)throw new Error('Folder not preserved');console.log('PASS: dos subidas simultáneas MP4/M4V y carpeta/subcarpeta conservada');
  setFallback(actor,channel.id,results,{every:1,separatorIds:[results[1]],shuffle:true,reshuffle:true});
  await until(()=>stream('auto_'+channel.id),'AutoDJ worker: publicación disponible');
  await until(()=>{const r=db.prepare('SELECT cycle FROM playout_runtime WHERE channel_id=?').get(channel.id);return r?.cycle>=2;},'PASS: al menos dos ciclos completos de AutoDJ');
  await until(()=>db.prepare('SELECT current_asset FROM playout_runtime WHERE channel_id=?').get(channel.id)?.current_asset===results[1],'AutoDJ: segundo elemento en curso');
  const autoBefore=await streamInfo('auto_'+channel.id);if(!autoBefore)throw new Error('AutoDJ no está disponible antes de editar la cola.');
  const queueChangedAt=Date.now();setFallback(actor,channel.id,[results[0]],{every:0,separatorIds:[],shuffle:false,reshuffle:false});
  await until(()=>{const r=db.prepare('SELECT current_asset,updated_at FROM playout_runtime WHERE channel_id=?').get(channel.id);return r?.current_asset===results[0]&&r.updated_at>=queueChangedAt;},'PASS: cola actualizada sin detener la salida AutoDJ');
  const autoAfter=await streamInfo('auto_'+channel.id);if(!autoAfter||autoAfter.input.createdTime!==autoBefore.input.createdTime)throw new Error('La salida AutoDJ se reinició al editar la cola.');
  setFallback(actor,channel.id,results,{every:1,separatorIds:[results[1]],shuffle:true,reshuffle:true});
  logoId=randomBytes(16).toString('hex');await mkdir(join(dataDir,'logos'),{recursive:true});
 await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=1280x720','-frames:v','1','-pix_fmt','rgba','-threads','1',join(dataDir,'logos',logoId+'.png')]);db.prepare('INSERT INTO logos VALUES(?,?,?,?)').run(logoId,userId,1280,720);
 saveWatermark(actor,channel.id,{enabled:true,logo:logoId,style:'full',position:'bottom-right',size:12,opacity:80});
 const playback=`http://ome:3333/live/${channel.id}/llhls.m3u8`;
 await until(async()=>{try{return (await fetch(playback,{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}},'Compositor: señal pública disponible');
 await sleep(10000);
 let pixel=[];for(let attempt=0;attempt<10;attempt++){try{const {stdout}=await run('ffmpeg',['-nostdin','-v','error','-live_start_index','-1','-i',playback,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',timeout:35000});pixel=[...stdout.subarray(0,3)];if(pixel.length===3&&pixel[2]>=150&&pixel[0]<=80&&pixel[1]<=80)break;}catch{}await sleep(4000);}
 if(pixel.length!==3||pixel[2]<150||pixel[0]>80||pixel[1]>80){
  console.error('Worker diagnostic:',db.prepare('SELECT state,cycle FROM playout_runtime WHERE channel_id=?').get(channel.id));
  const diagnostic=await fetch(`http://ome:3333/live/auto_${channel.id}/llhls.m3u8`);const manifest=await diagnostic.text();console.error('AutoDJ diagnostic:',diagnostic.status,manifest.match(/RESOLUTION=[^,\n]+/)?.[0]);
  try{const frame=await run('ffmpeg',['-nostdin','-v','error','-live_start_index','-1','-i',`http://ome:3333/live/auto_${channel.id}/llhls.m3u8`,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',timeout:30000});console.error('AutoDJ pixel:',[...frame.stdout.subarray(0,3)]);}catch{console.error('AutoDJ frame unavailable');}
  throw new Error('Logo not baked: '+JSON.stringify(pixel));
 }console.log('PASS: marca de agua decodificada desde la señal pública',pixel);
 publisher=spawn('ffmpeg',['-nostdin','-v','error','-stream_loop','-1','-re','-i',join(dir,'one.mp4'),'-c','copy','-f','flv',`rtmp://ome:1935/live/in_${channel.id}?key=${key}`],{stdio:'ignore'});
 await until(()=>stream('in_'+channel.id),'Directo de prueba conectado con marca de agua');
 await until(()=>stream('marked_'+channel.id),'Directo con marca: publicación disponible');await sleep(24000);
 const rawFrame=await run('ffmpeg',['-nostdin','-v','error','-live_start_index','-1','-i',`http://ome:3333/live/in_${channel.id}/llhls.m3u8`,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',timeout:35000});
 if(rawFrame.stdout.length<3||rawFrame.stdout[0]<150)throw new Error('No se confirmó el directo en la fuente interna.');
 const liveFrame=await run('ffmpeg',['-nostdin','-v','error','-live_start_index','-1','-i',playback,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',timeout:35000});
 if(liveFrame.stdout.length<3||liveFrame.stdout[2]<150||liveFrame.stdout[0]>80)throw new Error('La marca no se conservó en el directo.');console.log('PASS: directo rojo interno y marca azul quemada en la salida pública');
 publisher.kill('SIGTERM');await until(async()=>!await stream('in_'+channel.id),'Retorno al AutoDJ después del directo');
}finally{
 publisher?.kill('SIGTERM');
 db.prepare('DELETE FROM channels WHERE id=?').run(channel.id);for(const name of [channel.id,'raw_'+channel.id])await unlink(join(dataDir,'schedules',name+'.sch')).catch(()=>{});await sleep(2500);
 for(const asset of db.prepare('SELECT filename FROM assets WHERE owner_id=?').all(userId))await unlink(join(dataDir,'media',asset.filename)).catch(()=>{});
 db.prepare('DELETE FROM assets WHERE owner_id=?').run(userId);db.prepare('DELETE FROM folders WHERE owner_id=?').run(userId);db.prepare('DELETE FROM logos WHERE owner_id=?').run(userId);db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);db.prepare('DELETE FROM users WHERE id=?').run(userId);db.prepare('DELETE FROM playout_runtime WHERE channel_id=?').run(channel.id);if(logoId)await unlink(join(dataDir,'logos',logoId+'.png')).catch(()=>{});await rm(dir,{recursive:true,force:true});
}
