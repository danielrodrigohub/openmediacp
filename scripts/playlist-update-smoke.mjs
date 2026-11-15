// Verify AutoDJ queue edits do not recreate its live RTMP publisher.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {mkdir,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {db} from '../src/server/db.ts';
import {dataDir} from '../src/server/config.ts';
import {createUser} from '../src/server/auth.ts';
import {createChannel,removeSchedule,setFallback} from '../src/server/channels.ts';

const run=promisify(execFile),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const nonce=randomBytes(8).toString('hex'),userId=await createUser(`queue${nonce}`,randomBytes(24).toString('hex'),'client');
const actor={id:userId,username:`queue${nonce}`,role:'client'},channel=createChannel('Prueba temporal de cola',userId,actor).channel;
const assets=[randomBytes(16).toString('hex'),randomBytes(16).toString('hex')],files=assets.map(id=>join(dataDir,'media',`${id}.mp4`));
const api=process.env.OME_API_URL||'http://ome:8081',headers={Authorization:'Basic '+Buffer.from(process.env.OME_API_TOKEN).toString('base64')};
async function stream(){try{const r=await fetch(`${api}/v1/vhosts/default/apps/live/streams/auto_${channel.id}`,{headers,signal:AbortSignal.timeout(1500)});return r.ok?(await r.json()).response:null;}catch{return null;}}
async function wait(check,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await check()){console.log(label);return;}await sleep(500);}throw new Error(`${label}: timeout`);}
try{
 await mkdir(join(dataDir,'media'),{recursive:true});
 for(let i=0;i<assets.length;i++){
  const color=i?'blue':'green';
  await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',`color=c=${color}:s=160x90:r=25`,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','5','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p','-bf','0','-g','50','-c:a','aac','-ar','48000','-ac','2','-b:a','64k','-movflags','+faststart',files[i]]);
  db.prepare('INSERT INTO assets(id,owner_id,name,filename,bytes,created_at,folder,duration,channel_id) VALUES(?,?,?,?,?,?,?,?,?)').run(assets[i],userId,`clip-${i}.mp4`,`${assets[i]}.mp4`,(await stat(files[i])).size,Date.now(),'',5,channel.id);
 }
 setFallback(actor,channel.id,assets,{shuffle:false,reshuffle:false,every:0,separatorIds:[]});
 await wait(async()=>{const s=await stream();return s?.input?.sourceType==='Rtmp';},'AutoDJ en línea');
 await wait(()=>db.prepare('SELECT current_asset FROM playout_runtime WHERE channel_id=?').get(channel.id)?.current_asset===assets[1],'Reproduciendo el segundo clip');
 const before=await stream();if(!before)throw new Error('No se pudo leer AutoDJ antes del cambio.');
 const changedAt=Date.now();setFallback(actor,channel.id,[assets[0]],{shuffle:false,reshuffle:false,every:0,separatorIds:[]});
 await wait(()=>{const state=db.prepare('SELECT current_asset,updated_at FROM playout_runtime WHERE channel_id=?').get(channel.id);return state?.current_asset===assets[0]&&state.updated_at>=changedAt;},'Cola nueva aplicada al terminar el clip actual');
 const after=await stream();if(!after||after.input.createdTime!==before.input.createdTime)throw new Error('AutoDJ volvió a publicar y reinició el stream al editar la playlist.');
 console.log('PASS: la cola cambió sin reiniciar el stream AutoDJ.');
}finally{
 db.prepare('UPDATE channels SET enabled=0 WHERE id=?').run(channel.id);removeSchedule(channel.id);
 for(let i=0;i<20;i++){if(!await stream())break;await sleep(500);}
 for(const file of files)await unlink(file).catch(()=>{});
 db.prepare('DELETE FROM assets WHERE channel_id=?').run(channel.id);db.prepare('DELETE FROM folders WHERE owner_id=?').run(userId);db.prepare('DELETE FROM playout_runtime WHERE channel_id=?').run(channel.id);db.prepare('DELETE FROM channels WHERE id=?').run(channel.id);db.prepare('DELETE FROM users WHERE id=?').run(userId);
}
