import type { APIRoute } from 'astro';
import { createHmac,timingSafeEqual } from 'node:crypto';
import { db } from '../../server/db.ts';
import {workerKey} from '../../server/watermark.ts';
import { digest } from '../../server/auth.ts';
export const POST:APIRoute=async ({request})=>{
 const deny=()=>Response.json({allowed:false},{status:403});
 const secret=process.env.OME_ADMISSION_SECRET;if(!secret) return deny();
 const reader=request.body?.getReader();if(!reader) return deny();let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return deny();}chunks.push(value);}
 const raw=Buffer.concat(chunks);const expected=createHmac('sha1',secret).update(raw).digest();
 const signature=Buffer.from(request.headers.get('x-ome-signature')||'','base64url');if(signature.length!==expected.length||!timingSafeEqual(signature,expected))return deny();
 try{
  const data=JSON.parse(raw.toString());const r=data.request;
  if(!r||!Number.isFinite(Date.parse(r.time))||Math.abs(Date.now()-Date.parse(r.time))>300000)return deny();
  if(r.status==='closing')return Response.json({});
  if(r.direction!=='incoming'||String(r.protocol).toLowerCase()!=='rtmp'||r.status!=='opening')return deny();
  const url=new URL(r.url);const match=url.pathname.match(/^\/live\/(in_|auto_|marked_)?([a-f0-9]{16})$/);if(!match)return deny();
  const row=db.prepare('SELECT ingest_hash FROM channels WHERE id=? AND enabled=1').get(match[2]) as {ingest_hash:string}|undefined;
  const supplied=digest(url.searchParams.get('key')||'');
  const expectedHash=match[1]==='in_'?row?.ingest_hash:process.env.OME_WORKER_SECRET?digest(workerKey((match[1]||'')+match[2])):null;
  const allowed=!!row&&!!expectedHash&&timingSafeEqual(Buffer.from(expectedHash),Buffer.from(supplied));
  // Strip the publish secret before the engine stores the effective stream URL.
  url.search='';return Response.json({allowed,...(allowed?{new_url:url.toString()}:{} )});
 }catch{return deny();}
};
