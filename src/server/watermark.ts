import {createHmac} from 'node:crypto';
import {db,audit} from './db.ts';
import {accessibleChannel,writeSchedule} from './channels.ts';
import {channelOrder,filenames} from './playlist.ts';
import type {User} from './config.ts';
import {InputError} from './http.ts';
export type Watermark={enabled:boolean;logo:string;style:'auto'|'full'|'corner';position:'top-left'|'top-right'|'bottom-left'|'bottom-right';size:number;opacity:number;frameRate:'source'|'25'|'30'};
export const defaultWatermark:Watermark={enabled:false,logo:'',style:'auto',position:'bottom-right',size:12,opacity:80,frameRate:'source'};
export function workerKey(name:string){const secret=process.env.OME_WORKER_SECRET;if(!secret)throw new Error('Worker not configured');return createHmac('sha256',secret).update(name).digest('base64url');}
export function saveWatermark(user:User,id:string,value:unknown,event='watermark_updated'){
 const channel=accessibleChannel(user,id);if(!value||typeof value!=='object')throw new InputError('Configuración no válida.');const v={...defaultWatermark,frameRate:JSON.parse(channel.watermark||'{}').frameRate||'source',...value} as Watermark;
 if(!['source','25','30'].includes(v.frameRate)||typeof v.enabled!=='boolean'||!['auto','full','corner'].includes(v.style)||!['top-left','top-right','bottom-left','bottom-right'].includes(v.position)||!Number.isFinite(Number(v.size))||Number(v.size)<3||Number(v.size)>50||!Number.isFinite(Number(v.opacity))||Number(v.opacity)<0||Number(v.opacity)>100)throw new InputError('Revisa el tamaño, la opacidad y la posición.');
 if(v.enabled&&(!process.env.OME_WORKER_SECRET||!db.prepare('SELECT id FROM logos WHERE id=? AND owner_id=?').get(v.logo,channel.owner_id)))throw new InputError('Selecciona una imagen del canal y verifica que el compositor esté configurado.');
 const mark:Watermark={enabled:v.enabled,logo:String(v.logo),style:v.style,position:v.position,size:Number(v.size),opacity:Number(v.opacity),frameRate:v.frameRate};
 const updated={...channel,watermark:JSON.stringify(mark)};writeSchedule(updated,filenames(channelOrder(channel),channel.owner_id));
 db.prepare('UPDATE channels SET watermark=? WHERE id=?').run(updated.watermark,id);audit(user.id,event,id);return mark;
}
export function overlayFilter(mark:Watermark,width:number,height:number,logoIndex=1){const full=mark.style==='full'||mark.style==='auto'&&width>=1280&&Math.abs(width/height-16/9)<0.05;
 if(full)return `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[base];[${logoIndex}:v]scale=1280:720,format=rgba[logo];[base][logo]overlay=0:0:format=yuv420:shortest=0[v]`;
 const x=mark.position.endsWith('right')?'main_w-overlay_w-24':'24';const y=mark.position.startsWith('bottom')?'main_h-overlay_h-24':'24';
 return `[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1[base];[${logoIndex}:v]scale=${Math.round(1280*mark.size/100)}:-1,format=rgba,colorchannelmixer=aa=${mark.opacity/100}[logo];[base][logo]overlay=${x}:${y}:format=yuv420:shortest=0[v]`;
}
