import type {APIRoute} from 'astro';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {accessibleChannel} from '../../../server/channels.ts';
import {dataDir} from '../../../server/config.ts';
import {db} from '../../../server/db.ts';
import {InputError,apiError} from '../../../server/http.ts';
const run=promisify(execFile);let active=0;
export const POST:APIRoute=async({locals,request,params})=>{
 if(active>=2)return Response.json({error:'Hay imágenes procesándose. Inténtalo en unos segundos.'},{status:429});active++;
 const id=randomBytes(16).toString('hex');const dir=join(dataDir,'logos'),input=join(dir,id+'.upload'),output=join(dir,id+'.png');let saved=false;
 try{const channel=accessibleChannel(locals.user!,params.id!);const count=db.prepare('SELECT count(*) AS total FROM logos WHERE owner_id=?').get(channel.owner_id) as {total:number};if(count.total>=20)throw new InputError('Máximo de 20 imágenes por cliente.');
  if(request.headers.get('content-type')!=='image/png')throw new InputError('Selecciona una imagen PNG.');
  const reader=request.body?.getReader();if(!reader)throw new InputError('Imagen vacía.');let size=0;const chunks:Uint8Array[]=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024**2){await reader.cancel();throw new InputError('Máximo 5 MB por imagen.');}chunks.push(value);}
  await mkdir(dir,{recursive:true});await writeFile(input,Buffer.concat(chunks),{mode:0o600});const probe=await run('ffprobe',['-v','error','-protocol_whitelist','file','-show_streams','-of','json',input],{timeout:10000});const track=JSON.parse(probe.stdout).streams?.[0];
  if(track?.codec_name!=='png'||track.width>4096||track.height>4096||track.width<1||track.height<1)throw new InputError('Usa un PNG de hasta 4096 × 4096 píxeles.');
  await run('ffmpeg',['-nostdin','-v','error','-protocol_whitelist','file','-i',input,'-frames:v','1','-pix_fmt','rgba','-threads','1',output],{timeout:15000});
  db.prepare('INSERT INTO logos VALUES(?,?,?,?)').run(id,channel.owner_id,track.width,track.height);saved=true;return Response.json({message:'Imagen preparada.',id});
 }catch(e){return apiError(e);}finally{active--;await unlink(input).catch(()=>{});if(!saved)await unlink(output).catch(()=>{});}
};
