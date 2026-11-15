import {setTimeout as delay} from 'node:timers/promises';
import {accessibleChannel,removeSchedule,writeSchedule} from './channels.ts';
import {channelOrder,filenames} from './playlist.ts';
import {db,audit} from './db.ts';
import type {User} from './config.ts';
import {InputError} from './http.ts';

const operations=new Set<string>();
export type ChannelAction='start'|'stop'|'restart';

async function waitForOutput(id:string,published:boolean){
 const base=process.env.OME_API_URL,token=process.env.OME_API_TOKEN;
 if(!base||!token)return false;
 const headers={Authorization:'Basic '+Buffer.from(token).toString('base64')};
 const end=Date.now()+12000;
 do{
  try{
   const r=await fetch(`${base}/v1/vhosts/default/apps/live/streams/${id}`,{headers,signal:AbortSignal.timeout(1500)});
   await r.body?.cancel();
   if(r.status===(published?200:404))return true;
   if(r.status!==200&&r.status!==404)return false;
  }catch{return false;}
  await delay(500);
 }while(Date.now()<end);
 return false;
}

export async function controlChannel(user:User,id:string,action:ChannelAction){
 accessibleChannel(user,id);
 if(operations.has(id))throw new InputError('Ya hay una operación en curso para este canal.');
 operations.add(id);
 try{
  if(action!=='start'){
   db.prepare('UPDATE channels SET enabled=0 WHERE id=?').run(id);
   removeSchedule(id);
   const stopped=await waitForOutput(id,false);
   if(action==='stop'||!stopped){
    audit(user.id,'channel_stopped',id);
    return {message:stopped?'Salida pública detenida.':action==='restart'?'El canal quedó deshabilitado. No se confirmó el cierre de la salida, así que no se volvió a iniciar.':'Canal deshabilitado. No se pudo confirmar el cierre de la salida.'};
   }
  }
  // Reload settings in case the playlist was edited while the output was stopping.
  const current=accessibleChannel(user,id);
  writeSchedule({...current,enabled:1},filenames(channelOrder(current),current.owner_id));
  db.prepare('UPDATE channels SET enabled=1 WHERE id=?').run(id);
  audit(user.id,action==='restart'?'channel_restarted':'channel_started',id);
  const published=await waitForOutput(id,true);
  return {message:published?(action==='restart'?'Salida reiniciada y publicada.':'Salida publicada.'):'Canal habilitado. Todavía no se pudo confirmar la salida publicada.'};
 }finally{operations.delete(id);}
}
