import type { APIRoute } from 'astro';
import {db,audit} from "../../../server/db";
import {parseChannelQuota} from "../../../server/channel-storage";
import { createChannel,accessibleChannel } from '../../../server/channels.ts';
import { jsonBody,text,InputError,apiError } from '../../../server/http.ts';
export const POST:APIRoute=async ({locals,request})=>{try{const body=await jsonBody(request);
 if(body.action==='storage'){
  const channel=accessibleChannel(locals.user!,text(body.channel,16));
  const quota=parseChannelQuota(body);
  if(!quota&&(JSON.parse(channel.fallback).length||JSON.parse(channel.autodj).separatorIds?.length))
   throw new InputError('Quita los videos y separadores de la playlist de respaldo antes de cambiar a Solo streaming.');
  db.prepare('UPDATE channels SET storage_quota_bytes=? WHERE id=?').run(quota,channel.id);
  audit(locals.user!.id,'channel_storage_updated',channel.id);
  return Response.json({message:'Modalidad y cuota guardadas.'});
 }
 const quota=body.storageMode===undefined?null:parseChannelQuota(body);
 if(!Number.isSafeInteger(body.owner)) throw new InputError('Selecciona el propietario.');const result=createChannel(text(body.name,80),body.owner as number,locals.user!,quota);return Response.json({message:'Canal creado. Guarda la clave: solo se muestra una vez.',id:result.channel.id,key:`in_${result.channel.id}?key=${result.key}`});}catch(error){return apiError(error);}};
