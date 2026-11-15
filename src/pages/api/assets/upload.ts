import type { APIRoute } from 'astro';
import { createHash,randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { mkdir,open,unlink,stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir,maxOutputBytes } from '../../../server/config.ts';
import {accessibleChannel} from '../../../server/channels.ts';
import {channelQuota,channelStorageUsage} from '../../../server/channel-storage.ts';
import { db,audit } from '../../../server/db.ts';
import { normalizeFolder,ensureFolder } from '../../../server/library.ts';
import { findDuplicateUpload } from '../../../server/upload-dedupe.ts';
import { InputError,apiError } from '../../../server/http.ts';
import {mediaDuration,incompleteTracks,copyCompatibleAudio} from '../../../server/upload-media.ts';
import {beginUploadJob,finishUploadJob} from '../../../server/upload-jobs.ts';
class UploadTimeout extends InputError {}
const run=promisify(execFile);let busy=0;
export const POST:APIRoute=async ({request,locals})=>{
 if(busy>=2)return Response.json({error:'El servidor está procesando otros archivos. La cola esperará su turno.'},{status:429});
 busy++;const id=randomBytes(16).toString('hex');const media=join(dataDir,'media');const input=join(media,`${id}.upload`);const output=join(media,`${id}.mp4`);let stored=false,background=false;
 const cleanup=async()=>{busy--;await unlink(input).catch(()=>{});if(!stored)await unlink(output).catch(()=>{});};
 try{
  if(request.headers.get('content-type')!=='application/octet-stream')throw new InputError('Selecciona un archivo de video.');
  const requested=request.headers.get('x-channel-id');
  const candidates=requested?[]:db.prepare('SELECT id FROM channels WHERE owner_id=? LIMIT 2')
   .all(Number(request.headers.get('x-owner-id')||locals.user!.id)) as {id:string}[];
  const channelId=requested||(candidates.length===1?candidates[0].id:'');
  if(!channelId)throw new InputError('Selecciona el canal donde quieres subir el video.');
   const channel=accessibleChannel(locals.user!,channelId);
   const ownerId=channel.owner_id;
   const quota=channelQuota(channel);
   if(!quota)throw new InputError('Este canal es solo streaming. Las subidas están deshabilitadas.');
   const folder=normalizeFolder(decodeURIComponent(request.headers.get('x-folder')||''));
   const name=decodeURIComponent(request.headers.get('x-file-name')||'video.mp4').slice(0,120).normalize('NFC');
   const expectedHash=(request.headers.get('x-file-sha256')||'').toLowerCase();
   if(expectedHash&&!/^[a-f0-9]{64}$/.test(expectedHash))throw new InputError('Huella de archivo no válida.');
   const used=channelStorageUsage(channel).bytes;
   if(used>=quota)throw new InputError('El canal alcanzó su cuota de almacenamiento.');
   await mkdir(media,{recursive:true});const file=await open(input,'wx',0o600);let size=0;const sourceHash=createHash('sha256');
   try{
    const reader=request.body?.getReader();if(!reader)throw new InputError('Archivo vacío.');
    while(true){let timer:ReturnType<typeof setTimeout>|undefined;
    const next=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new UploadTimeout('La transferencia dejó de enviar datos. Reintenta el archivo.'));void reader.cancel().catch(()=>{});},60000);})]).finally(()=>clearTimeout(timer));
    const {done,value}=next;if(done)break;size+=value.length;if(size>128*1024**2){await reader.cancel();throw new InputError('El máximo por archivo es 128 MB.');}sourceHash.update(value);await file.writeFile(value);}
   }finally{await file.close();}
   const sourceSha256=sourceHash.digest('hex');
   if(expectedHash&&expectedHash!==sourceSha256)throw new InputError('El archivo cambió durante la verificación. Vuelve a seleccionarlo.');
   const duplicate=findDuplicateUpload(ownerId,channel.id,folder,name,size,sourceSha256);
   if(duplicate)return Response.json({duplicate:true,message:'Ya estaba subido; se omitió.'});
   const prepare=async()=>{
   const probe=await run('ffprobe',['-v','error','-protocol_whitelist','file','-show_streams','-show_format','-of','json',input],{timeout:15000,maxBuffer:1024*1024});
  const info=JSON.parse(probe.stdout);const duration=mediaDuration(info);
  if(!info.format?.format_name?.includes('mp4')||!info.streams?.some((s:{codec_type:string})=>s.codec_type==='video')||!info.streams?.some((s:{codec_type:string})=>s.codec_type==='audio')||!Number.isFinite(duration)||duration<=0||duration>3600)throw new InputError('Usa MP4 o M4V con video y audio, de hasta una hora.');
  const outputLimit=Math.min(maxOutputBytes,quota-used);if(outputLimit<1024**2)throw new InputError('No queda espacio de almacenamiento disponible.');
  const video=info.streams.find((s:{codec_type:string})=>s.codec_type==='video');const audio=info.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
   const [rateN,rateD]=String(video.r_frame_rate||'25/1').split('/').map(Number);const nativeFps=rateN/rateD;
   // ffprobe can omit the per-video bitrate on otherwise copy-compatible MP4s.
   // Estimate it from the container total before deciding to spend CPU on a recode.
   const totalBitrate=Number(info.format?.bit_rate)||Math.round(size*8/duration),videoBitrate=Number(video.bit_rate)>0?Number(video.bit_rate):Math.max(0,totalBitrate-(Number(audio.bit_rate)||0));
   const copyVideo=videoBitrate>0&&videoBitrate<=1072000&&video.codec_name==='h264'&&video.pix_fmt==='yuv420p'&&video.width<=1280&&video.height<=720&&nativeFps<=30&&['1:1','N/A',undefined].includes(video.sample_aspect_ratio);
  const copyAudio=copyCompatibleAudio(audio);
  const videoArgs=copyVideo?['-c:v','copy']:['-vf',"scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1",...(nativeFps>30?['-r','30']:[]),'-c:v','libx264','-preset','veryfast','-threads','1','-b:v','742k','-maxrate','1072k','-bufsize','2144k','-pix_fmt','yuv420p','-bf','0','-g',String(Math.round(Math.min(nativeFps||25,30)*2))];
  const audioArgs=copyAudio?['-c:a','copy']:['-c:a','aac','-ar','48000','-ac','2','-b:a','128k'];
  await run('nice',['-n','15','ffmpeg','-nostdin','-v','error','-protocol_whitelist','file','-i',input,'-map','0:v:0','-map','0:a:0',...videoArgs,...audioArgs,'-fs',String(outputLimit),'-movflags','+faststart',output],{timeout:30*60*1000,maxBuffer:1024*1024});
   const bytes=(await stat(output)).size;const resultProbe=await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{timeout:10000});const prepared=JSON.parse(resultProbe.stdout);const preparedDuration=mediaDuration(prepared);
   if(incompleteTracks(info,prepared)){
    if(bytes>=outputLimit-1024*1024)throw new InputError(outputLimit<maxOutputBytes?'No queda suficiente espacio en la cuota del canal para este video.':'El video preparado alcanzó el límite por archivo.');
    throw new InputError('La preparación del video quedó incompleta. Reintenta el archivo; no se ha guardado una versión recortada.');
   }const latest=accessibleChannel(locals.user!,channel.id);
   const duplicateAfterProcessing=findDuplicateUpload(ownerId,channel.id,folder,name,size,sourceSha256);
   if(duplicateAfterProcessing)return Response.json({duplicate:true,message:'Ya estaba subido; se omitió.'});
   if(bytes+channelStorageUsage(latest).bytes>channelQuota(latest))throw new InputError('El video excede la cuota disponible del canal.');
   ensureFolder(ownerId,folder);db.prepare('INSERT INTO assets(id,owner_id,name,filename,bytes,created_at,folder,duration,channel_id,source_bytes,source_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,ownerId,name,`${id}.mp4`,bytes,Date.now(),folder,preparedDuration,channel.id,size,sourceSha256);stored=true;audit(locals.user!.id,'asset_uploaded',id);
  return Response.json({message:'Video preparado. Ya puedes añadirlo al respaldo.',id});
   };
   if(request.headers.get('x-upload-async')==='1'){
    beginUploadJob(id,locals.user!.id);background=true;
    void (async()=>{try{const response=await prepare();finishUploadJob(id,await response.json());}
     catch(error){finishUploadJob(id,{error:error instanceof InputError?error.message:'No se pudo preparar el video. Reintenta el archivo.'},true);}
     finally{await cleanup();}})().catch(()=>console.error('Upload processing cleanup failed'));
    return Response.json({jobId:id,state:'processing'},{status:202});
   }
   return await prepare();
 }catch(error){return error instanceof UploadTimeout?Response.json({error:error.message},{status:408}):apiError(error);}finally{if(!background)await cleanup();}
};
