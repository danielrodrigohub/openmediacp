// Run only inside the local test container: exercises real OME + FFmpeg.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {dataDir} from '../src/server/config.ts';
import {db} from '../src/server/db.ts';
import {createUser} from '../src/server/auth.ts';
import {createChannel} from '../src/server/channels.ts';
const run=promisify(execFile);
const token=process.env.OME_API_TOKEN;
const api=process.env.OME_API_URL;
if(!token||!api)throw new Error('OME settings missing');
const userId=await createUser('smoke'+randomBytes(4).toString('hex'),randomBytes(24).toString('hex'),'client');
const actor={id:userId,username:'smoke',role:'client'};
const {channel,key}=createChannel('Prueba automática de continuidad',userId,actor);
const headers={Authorization:'Basic '+Buffer.from(token).toString('base64')};
async function available(name){try{return (await fetch(`${api}/v1/vhosts/default/apps/live/streams/${name}`,{headers,signal:AbortSignal.timeout(1500)})).status===200;}catch{return false;}}
async function until(check,message,limit=45){for(let i=0;i<limit;i++){if(await check()){console.log(message);return;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+' : timeout');}
const playback=`http://ome:3333/live/${channel.id}/llhls.m3u8`;
async function frame(){const {stdout}=await run('ffmpeg',['-nostdin','-v','error','-live_start_index','-1','-i',playback,'-frames:v','1','-vf','scale=1:1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{encoding:'buffer',timeout:35000,maxBuffer:1024*1024});if(stdout.length<3)throw new Error('No video frame decoded');return [...stdout.subarray(0,3)];}
let live;
try{
 await until(()=>available(channel.id),'Fallback: canal disponible');
 await until(async()=>{try{return (await fetch(playback,{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}},'Fallback: manifiesto LLHLS disponible');
 const before=await frame();console.log('Fallback: video decodificado',before);
 // Synthetic red video and tone are distinguishable from the dark emergency card.
 live=spawn('ffmpeg',['-nostdin','-v','error','-re','-f','lavfi','-i','color=c=red:s=1280x720:r=25','-re','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-c:v','libx264','-preset','ultrafast','-threads','1','-tune','zerolatency','-pix_fmt','yuv420p','-g','50','-c:a','aac','-ar','48000','-ac','2','-f','flv',`rtmp://ome:1935/live/in_${channel.id}?key=${key}`],{stdio:['ignore','ignore','pipe']});
 let publishError=false;live.on('error',()=>publishError=true);live.stderr.on('data',chunk=>{console.log('Encoder:',chunk.toString().replace(/key=[A-Za-z0-9_-]+/g,'key=[redacted]').trim());});
 await until(()=>available('in_'+channel.id),'Directo: publicación autenticada');
 await new Promise(r=>setTimeout(r,14000));
 const during=await frame();if(publishError||during[0]<150||during[1]>100||during[2]>100)throw new Error('El frame del directo no corresponde a la señal roja: '+JSON.stringify(during));console.log('Directo: video rojo decodificado',during);
 live.kill('SIGTERM');await until(async()=>!await available('in_'+channel.id),'Directo detenido');
 await new Promise(r=>setTimeout(r,14000));const after=await frame();if(after[0]>100||after[1]>100||after[2]>130)throw new Error('El frame no volvió a la cartela de respaldo.');console.log('Fallback recuperado: video decodificado',after);
 console.log('PASS: fallback → directo → fallback, misma URL LLHLS.');
}finally{live?.kill('SIGTERM');try{unlinkSync(join(dataDir,'schedules',channel.id+'.sch'));}catch{}db.prepare('DELETE FROM channels WHERE id=?').run(channel.id);db.prepare('DELETE FROM users WHERE id=?').run(userId);}
