import {playlistAssetIds,maxPlaylistEntries,maxPlaylistVideos,type PlaylistEntry} from './playlist-entries.ts';
import {randomInt} from 'node:crypto';
import {db} from './db.ts';
import {InputError} from './http.ts';
import type {Channel} from './config.ts';
export type AutoDJ={every:number;separatorIds:string[];shuffle:boolean;reshuffle:boolean;order?:string[];entries?:PlaylistEntry[];separatorEntries?:PlaylistEntry[]};
export const defaultAutoDJ:AutoDJ={every:0,separatorIds:[],shuffle:false,reshuffle:false};
export function shuffled<T>(input:T[]){const out=[...input];for(let i=out.length-1;i>0;i--){const j=randomInt(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}
export function interleave(videos:string[],separators:string[],every:number){const out:string[]=[];let next=0;videos.forEach((id,i)=>{out.push(id);if(every>0&&separators.length&&(i+1)%every===0)out.push(separators[next++%separators.length]);});return out;}
export function validateAutoDJ(value:unknown,owner:number,channel:string):AutoDJ {
 if(!value||typeof value!=='object')return {...defaultAutoDJ};
 const v=value as Record<string,unknown>;const every=Number(v.every??0);const ids=v.separatorIds??[];
 if(!Number.isInteger(every)||every<0||every>100||!Array.isArray(ids)||ids.length>maxPlaylistVideos||ids.some(id=>typeof id!=='string'))throw new InputError('Revisa el intervalo y los separadores.');
 const separatorFolders=new Map<string,string>();
 for(const id of ids){
  const asset=db.prepare('SELECT folder FROM assets WHERE id=? AND owner_id=? AND (channel_id IS NULL OR channel_id=?)').get(id,owner,channel) as {folder:string}|undefined;
  if(!asset)throw new InputError('Los separadores deben pertenecer al cliente.');
  separatorFolders.set(id,asset.folder);
 }
 const policy:AutoDJ={every,separatorIds:ids as string[],shuffle:!!v.shuffle,reshuffle:!!v.shuffle&&!!v.reshuffle};
 if(v.separatorEntries!==undefined){
  policy.separatorEntries=validatePlaylistEntries(v.separatorEntries,separatorFolders);
  policy.separatorIds=playlistAssetIds(policy.separatorEntries);
 }
 return policy;
}
export function validatePlaylistEntries(value:unknown,assets:Map<string,string>):PlaylistEntry[]{
 if(!Array.isArray(value)||value.length>maxPlaylistEntries)throw new InputError(`Selecciona hasta ${maxPlaylistEntries} entradas.`);
 const folders=new Set<string>(),videos=new Set<string>();
 const entries=value.map((entry:unknown):PlaylistEntry=>{
  if(typeof entry==='string'){
   if(!assets.has(entry)||videos.has(entry))throw new InputError('Video de playlist no válido.');
   videos.add(entry);
   return entry;
  }
  if(!entry||typeof entry!=='object'||!('folder' in entry)||!('ids' in entry))throw new InputError('Entrada de playlist no válida.');
  const {folder,ids}=entry;
  if(typeof folder!=='string'||!folder||folders.has(folder)||!Array.isArray(ids)||!ids.length||ids.length>maxPlaylistVideos||
     new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||assets.get(id)!==folder)){
   throw new InputError('Los videos deben pertenecer a la carpeta seleccionada.');
  }
  folders.add(folder);
  return {folder,ids};
 });
 if(playlistAssetIds(entries).length!==assets.size)throw new InputError('La selección de videos no coincide con la playlist.');
 return entries;
}
export function channelOrder(channel:Channel){const p={...defaultAutoDJ,...JSON.parse(channel.autodj||'{}')} as AutoDJ;const videos=JSON.parse(channel.fallback) as string[];return interleave(p.order||videos,p.separatorIds,p.every);}
export function filenames(ids:string[],owner:number){return ids.map(id=>{const row=db.prepare('SELECT filename FROM assets WHERE id=? AND owner_id=?').get(id,owner) as {filename:string}|undefined;if(!row)throw new InputError('Archivo no disponible.');return row.filename;});}
