import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,readFile,rm,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {db} from '../src/server/db.ts';
import {dataDir,origin,cookieName} from '../src/server/config.ts';
import {createChannel,removeSchedule} from '../src/server/channels.ts';
import {createUser,login} from '../src/server/auth.ts';
const uploadBase=process.env.UPLOAD_TEST_URL||'http://127.0.0.1:4321';
const run=promisify(execFile),nonce=randomBytes(6).toString('hex'),password=randomBytes(24).toString('hex');
const user=await createUser('upload'+nonce,password,'client'),dir=join(dataDir,'fixtures',nonce);await mkdir(dir,{recursive:true});
let channel;
try{
 channel=createChannel('Prueba de subida',user,{id:user,username:'upload'+nonce,role:'client'}).channel;
  const file=join(dir,'test.m4v');await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=green:s=320x180:r=30','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1','-c:v','libx264','-preset','ultrafast','-threads','1','-c:a','aac','-f','mp4',file]);
  const bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex'),session=await login('upload'+nonce,password,'m4v-test'),baseHeaders={origin,cookie:`${cookieName}=${session.token}`};
  const check=async()=>fetch(uploadBase+'/api/assets/check',{method:'POST',headers:{...baseHeaders,'content-type':'application/json'},body:JSON.stringify({channelId:channel.id,name:'test.m4v',size:bytes.length,folder:'formatos/m4v'})}).then(async r=>({status:r.status,body:await r.json()}));
  const before=await check();if(!before.body||before.body.duplicate)throw new Error('Fresh upload was incorrectly marked duplicate.');
  const upload=async()=>fetch(uploadBase+'/api/assets/upload',{method:'POST',headers:{...baseHeaders,'content-type':'application/octet-stream','x-channel-id':channel.id,'x-file-name':'test.m4v','x-folder':'formatos/m4v','x-upload-async':'1'},body:bytes}).then(async r=>({status:r.status,body:await r.json()}));
  let response=await upload();if(response.status!==202||!response.body.jobId)throw new Error('Upload did not acknowledge receipt before processing.');
  const jobId=response.body.jobId;for(let n=0;n<120;n++){
   const r=await fetch(uploadBase+'/api/assets/jobs/'+jobId,{headers:baseHeaders}),job=await r.json();
   if(!r.ok)throw new Error('Cannot read upload job');
   if(job.state==='error')throw new Error(job.error);
   if(job.state==='done'){response={status:200,body:job};break;}
   await new Promise(r=>setTimeout(r,500));
  }
  const body=response.body;if(response.status<200||response.status>=300||body.duplicate)throw new Error(body.error||'First upload failed.');
  const asset=db.prepare('SELECT name,filename,folder,duration,source_bytes,source_sha256 FROM assets WHERE id=? AND owner_id=?').get(body.id,user);if(asset.name!=='test.m4v'||!asset.filename.endsWith('.mp4')||asset.folder!=='formatos/m4v'||asset.duration<=0||asset.source_bytes!==bytes.length||asset.source_sha256!==sha256)throw new Error('Upload metadata did not persist correctly');
  const after=await check();if(!after.body.duplicate)throw new Error('Existing file was not detected by preflight.');const duplicate=await upload();if(duplicate.status<200||duplicate.status>=300||!duplicate.body.duplicate)throw new Error('Duplicate upload was not skipped on the server.');if(db.prepare('SELECT count(*) AS n FROM assets WHERE owner_id=? AND folder=?').get(user,'formatos/m4v').n!==1)throw new Error('Duplicate asset row was created.');
  const stored=join(dataDir,'media',asset.filename);const hashArgs=path=>['-nostdin','-v','error','-i',path,'-map','0:v:0','-c:v','copy','-an','-f','hash','-hash','sha256','pipe:1'];const a=await run('ffmpeg',hashArgs(file)),b=await run('ffmpeg',hashArgs(stored));if(a.stdout!==b.stdout)throw new Error('El video compatible fue recodificado.');const meta=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-of','json',stored])).stdout);const track=meta.streams.find(t=>t.codec_type==='video');if(track.r_frame_rate!=='30/1'||track.width!==320)throw new Error('Se alteraron FPS o resolución nativos.');const renamed=await fetch(uploadBase+'/api/assets/check',{method:'POST',headers:{...baseHeaders,'content-type':'application/json'},body:JSON.stringify({channelId:channel.id,name:'renamed.m4v',size:bytes.length,folder:'formatos/m4v',sha256})}).then(async r=>r.json());if(!renamed.duplicate)throw new Error('Renamed duplicate was not detected by content hash.');const different=await fetch(uploadBase+'/api/assets/check',{method:'POST',headers:{...baseHeaders,'content-type':'application/json'},body:JSON.stringify({channelId:channel.id,name:'test.m4v',size:bytes.length+7,folder:'formatos/m4v'})}).then(async r=>r.json());if(different.duplicate)throw new Error('Same name with a different size must not be skipped.');console.log('PASS: async upload returns 202, status reaches done; compatible M4V copied; name+size preflight skips re-uploads without hashing; renamed duplicates are caught by hash.');
}finally{for(const asset of db.prepare('SELECT filename FROM assets WHERE owner_id=?').all(user))await unlink(join(dataDir,'media',asset.filename)).catch(()=>{});db.prepare('DELETE FROM assets WHERE owner_id=?').run(user);db.prepare('DELETE FROM folders WHERE owner_id=?').run(user);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user);if(channel){removeSchedule(channel.id);db.prepare('DELETE FROM channels WHERE id=?').run(channel.id);}
db.prepare('DELETE FROM upload_jobs WHERE user_id=?').run(user);db.prepare('DELETE FROM users WHERE id=?').run(user);await rm(dir,{recursive:true,force:true});}
