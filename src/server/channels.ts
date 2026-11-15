import {playlistAssetIds,maxPlaylistVideos} from './playlist-entries.ts';
import { join } from 'node:path';
import { createHash,randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync } from 'node:fs';
import { db,audit } from './db.ts';
import { randomToken,digest } from './auth.ts';
import { dataDir,mediaOrigin,type Channel,type User } from './config.ts';
import {channelOrder,filenames,validateAutoDJ,validatePlaylistEntries,shuffled} from './playlist.ts';
import {channelQuota} from './channel-storage.ts';
import { InputError } from './http.ts';
export function accessibleChannel(user:User,id:string) {
  const channel=db.prepare('SELECT * FROM channels WHERE id=?').get(id) as Channel|undefined;
  if(!channel || user.role!=='admin'&&channel.owner_id!==user.id) throw new InputError('Canal no disponible.');
  return channel;
}
const liveScheduleMarker='<!-- live-source-exclusive -->';
function existingScheduleIsLive(id:string) {
  try{return readFileSync(join(dataDir,'schedules',`${id}.sch`),'utf8').includes(liveScheduleMarker);}catch{return false;}
}
export const scheduleIsLive=existingScheduleIsLive;
export function scheduleXml(channel:Channel,files:string[],liveAvailable=false) {
  const mark=JSON.parse(channel.watermark||'{}');
  const name=channel.id;
  // The worker is the continuous source for every configured fallback playlist.
  // OME schedules a finite list once, which otherwise ends after the final item.
  // Never leave AutoDJ as a second candidate while the OBS program is live.
  const useAuto=!liveAvailable&&(!!mark.enabled||files.length>0);
  const fallbackFiles=liveAvailable||useAuto?['emergency.mp4']:files.length?files:['emergency.mp4'];
  // Filenames are server-generated IDs, never caller-controlled paths or URLs.
  if(!/^[a-f0-9]{16}$/.test(channel.id)||files.some(f=>!/^([a-f0-9]{32}|emergency)\.mp4$/.test(f))) throw new InputError('Archivo no válido.');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Schedule>${liveAvailable?liveScheduleMarker:''}<Stream><Name>${name}</Name><BypassTranscoder>false</BypassTranscoder><VideoTrack>true</VideoTrack><AudioTrack>true</AudioTrack></Stream>
<FallbackProgram>${useAuto?`<Item url="stream://default/live/auto_${channel.id}" duration="-1" />`:''}${fallbackFiles.map(f=>`<Item url="file://${f}" />`).join('')}</FallbackProgram>
<Program name="live" scheduled="2000-01-01T00:00:00.000Z" repeat="true"><Item url="stream://default/live/${mark.enabled?'marked_':'in_'}${channel.id}" duration="-1" /></Program></Schedule>`;
}
export function removeSchedule(id:string) {
  if(!/^[a-f0-9]{16}$/.test(id))throw new InputError('Canal no válido.');
  for(const name of [id,'raw_'+id]){
    try{unlinkSync(join(dataDir,'schedules',name+'.sch'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
}
export function writeSchedule(channel:Channel,files:string[],liveAvailable?:boolean) {
  if(!channel.enabled)return;
  const dir=join(dataDir,'schedules');mkdirSync(dir,{recursive:true});
  const name=channel.id;
  const path=join(dir,`${name}.sch`);
  const exclusiveLive=liveAvailable??existingScheduleIsLive(channel.id);
  try{unlinkSync(join(dir,`raw_${channel.id}.sch`));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}writeFileSync(`${path}.tmp`,scheduleXml(channel,files,exclusiveLive),{mode:0o644});renameSync(`${path}.tmp`,path);
}
export function createChannel(name:string,owner:number,actor:User,quota:number|null=null) {
  if(!name.trim()||name.length>80) throw new InputError('Nombre del canal: 1 a 80 caracteres.');
  if(!db.prepare('SELECT id FROM users WHERE id=?').get(owner)) throw new InputError('Cliente no disponible.');
  const id=randomBytes(8).toString('hex');
  // Use independent cryptographic randomness for the identifier as well as its secret.
  const key=randomToken();const now=Date.now();
  db.prepare('INSERT INTO channels(id,name,owner_id,ingest_hash,created_at,storage_quota_bytes) VALUES(?,?,?,?,?,?)').run(id,name.trim(),owner,digest(key),now,quota);
  const channel=db.prepare('SELECT * FROM channels WHERE id=?').get(id) as Channel;
  try {writeSchedule(channel,[]);} catch(error) {db.prepare('DELETE FROM channels WHERE id=?').run(id);throw error;}
  audit(actor.id,'channel_created',id);return {channel,key};
}
export const playlistRevision=(channel:Pick<Channel,'fallback'|'autodj'>)=>createHash('sha256').update(channel.fallback+'\n'+channel.autodj).digest('hex');
export function setFallback(user:User,id:string,assetIds:string[],options?:unknown,revision?:unknown,entries?:unknown) {
  const channel=accessibleChannel(user,id);
  if(!channelQuota(channel))throw new InputError('Este canal es solo streaming.');
  if(revision!==undefined&&revision!==playlistRevision(channel))throw new InputError('La playlist cambió en otra sesión. Recarga la página antes de guardar; tus cambios siguen en el editor.');
  if(assetIds.length>maxPlaylistVideos||new Set(assetIds).size!==assetIds.length) throw new InputError(`Selecciona hasta ${maxPlaylistVideos} videos distintos.`);
  const assetFolders=new Map<string,string>();
  assetIds.forEach(assetId=>{
    const row=db.prepare('SELECT filename,owner_id,folder FROM assets WHERE id=? AND (channel_id IS NULL OR channel_id=?)').get(assetId,channel.id) as {filename:string;owner_id:number;folder:string}|undefined;
    if(!row||row.owner_id!==channel.owner_id) throw new InputError('El archivo debe pertenecer al cliente del canal.');
    assetFolders.set(assetId,row.folder);
  });
  const policy=validateAutoDJ(options??JSON.parse(channel.autodj||'{}'),channel.owner_id,channel.id);
  if(policy.reshuffle&&!process.env.OME_WORKER_SECRET)throw new InputError('El proceso AutoDJ del servidor aún no está configurado.');
  if(entries!==undefined)policy.entries=validatePlaylistEntries(entries,assetFolders);
  const ordered=policy.entries
    ?playlistAssetIds(policy.entries.map(entry=>typeof entry==='string'?entry:{...entry,ids:shuffled(entry.ids)}))
    :assetIds;
  policy.order=policy.shuffle?shuffled(ordered):[...ordered];
  const updated={...channel,fallback:JSON.stringify(assetIds),autodj:JSON.stringify(policy)};
  writeSchedule(updated,filenames(channelOrder(updated),channel.owner_id));
  db.prepare('UPDATE channels SET fallback=?,autodj=? WHERE id=?').run(updated.fallback,updated.autodj,id);audit(user.id,'fallback_updated',id);return playlistRevision(updated);
}
export const playbackUrl=(id:string)=>`${mediaOrigin}/live/${encodeURIComponent(id)}/llhls.m3u8`;
export async function engineStatus(id:string) {
  if(!process.env.OME_API_URL || !process.env.OME_API_TOKEN) return 'Sin conexión al motor';
  try {
    const response=await fetch(`${process.env.OME_API_URL}/v1/vhosts/default/apps/live/streams/${encodeURIComponent(id)}`,{headers:{Authorization:`Basic ${Buffer.from(process.env.OME_API_TOKEN).toString('base64')}`},signal:AbortSignal.timeout(2000)});
    return response.ok?'Señal disponible':response.status===404?'Esperando señal':'Motor no disponible';
  } catch{return 'Motor no disponible';}
}
