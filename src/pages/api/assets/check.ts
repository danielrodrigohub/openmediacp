import type {APIRoute} from 'astro';
import {accessibleChannel} from '../../../server/channels.ts';
import {channelQuota,channelStorageUsage} from '../../../server/channel-storage.ts';
import {InputError,apiError,jsonBody,text} from '../../../server/http.ts';
import {normalizeFolder} from '../../../server/library.ts';
import {findDuplicateUpload} from '../../../server/upload-dedupe.ts';

export const POST:APIRoute=async ({request,locals})=>{
 try{
  const body=await jsonBody(request,4096),channelId=text(body.channelId,32),name=text(body.name,120).normalize('NFC');
  const size=Number(body.size),sha256=typeof body.sha256==='string'&&body.sha256?text(body.sha256,64).toLowerCase():'';
  if(!name||!Number.isSafeInteger(size)||size<=0||size>128*1024**2)throw new InputError('Archivo no válido.');
  if(sha256&&!/^[a-f0-9]{64}$/.test(sha256))throw new InputError('Huella de archivo no válida.');
  if(!/\.(mp4|m4v)$/i.test(name))throw new InputError('Usa MP4 o M4V.');
  const channel=accessibleChannel(locals.user!,channelId),folder=normalizeFolder(text(body.folder??'',240));
  if(!channelQuota(channel))throw new InputError('Este canal es solo streaming. Las subidas están deshabilitadas.');
  const duplicate=findDuplicateUpload(channel.owner_id,channel.id,folder,name,size,sha256||null);
  if(duplicate)return Response.json({duplicate:true});
  if(channelStorageUsage(channel).bytes>=channelQuota(channel))throw new InputError('El canal alcanzó su cuota de almacenamiento.');
  return Response.json({duplicate:false});
 }catch(error){return apiError(error);}
};
