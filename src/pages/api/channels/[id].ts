import {controlChannel} from '../../../server/channel-control.ts';
import {saveWatermark} from '../../../server/watermark.ts';
import type { APIRoute } from 'astro';
import { accessibleChannel,setFallback } from '../../../server/channels.ts';
import { db,audit } from '../../../server/db.ts';
import { randomToken,digest } from '../../../server/auth.ts';
import { jsonBody,text,InputError,apiError } from '../../../server/http.ts';
export const POST:APIRoute=async ({locals,request,params})=>{try{
  const channel=accessibleChannel(locals.user!,params.id!);const body=await jsonBody(request,65536);
  if(body.action==='start'||body.action==='stop'||body.action==='restart')return Response.json(await controlChannel(locals.user!,channel.id,body.action));
  if(body.action==='public-player'){
    if(body.enabled!=='1'&&body.enabled!=='0')throw new InputError('Selecciona un estado válido.');
    const enabled=body.enabled==='1';
    db.prepare('UPDATE channels SET public_player=? WHERE id=?').run(Number(enabled),channel.id);
    audit(locals.user!.id,enabled?'public_player_enabled':'public_player_disabled',channel.id);
    return Response.json({message:enabled?'Página pública e iframe habilitados.':'Página pública e iframe deshabilitados.'});
  }
  if(body.action==='rotate') {const key=randomToken();db.prepare('UPDATE channels SET ingest_hash=? WHERE id=?').run(digest(key),channel.id);audit(locals.user!.id,'ingest_key_rotated',channel.id);return Response.json({message:'Nueva clave. La anterior ya no permite nuevas conexiones.',key:`in_${channel.id}?key=${key}`});}
  if(body.action==='fallback') {if(!Array.isArray(body.assets)||body.assets.some(x=>typeof x!=='string')) throw new InputError('Lista no válida.');const revision=setFallback(locals.user!,channel.id,body.assets as string[],body.options,body.revision,body.entries);return Response.json({revision,message:channel.enabled?'Playlist guardada. El motor puede tardar unos segundos en aplicar el cambio.':'Playlist guardada. Se aplicará al iniciar el canal.'});}
  if(body.action==='profile') {const current=accessibleChannel(locals.user!,channel.id);saveWatermark(locals.user!,channel.id,{...JSON.parse(current.watermark||'{}'),frameRate:body.frameRate},'frame_rate_updated');return Response.json({message:'Perfil guardado. El cambio puede reiniciar la composición de la señal.'});}
  if(body.action==='watermark') {saveWatermark(locals.user!,channel.id,body.options);return Response.json({message:'Marca de agua guardada. La señal se actualizará en unos segundos.'});}
  if(body.action==='rename') {const name=text(body.name,80).trim();if(!name) throw new InputError('Escribe un nombre.');db.prepare('UPDATE channels SET name=? WHERE id=?').run(name,channel.id);audit(locals.user!.id,'channel_renamed',channel.id);return Response.json({message:'Nombre actualizado.'});}
  throw new InputError('Acción no válida.');
}catch(error){return apiError(error);}};
