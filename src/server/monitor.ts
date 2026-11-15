import {cpus,freemem,totalmem} from 'node:os';
import {statfs} from 'node:fs/promises';
import {db} from './db.ts';
import {dataDir,idleLifetime,sessionLifetime} from './config.ts';

const viewers=new Map<string,{channel:string;seen:number}>();
const viewerLifetime=55000;
function pruneViewers(now=Date.now()){
 for(const [key,viewer] of viewers)if(now-viewer.seen>viewerLifetime)viewers.delete(key);
}
export function recordViewer(channel:string,id:string,playing:boolean){
 const key=channel+':'+id;
 if(!playing){viewers.delete(key);return;}
 const now=Date.now();
 if(viewers.size>=10000)pruneViewers(now);
 if(viewers.size<10000||viewers.has(key))viewers.set(key,{channel,seen:now});
}
export function viewerCounts(){
 pruneViewers();
 const counts=new Map<string,number>();
 for(const {channel} of viewers.values())counts.set(channel,(counts.get(channel)||0)+1);
 return counts;
}

type EngineStats={totalBytesOut?:number;createdTime?:string;connections?:{llhls?:number}};
export async function engineStats(channel?:string):Promise<EngineStats|null>{
 const {OME_API_URL,OME_API_TOKEN}=process.env;
 if(!OME_API_URL||!OME_API_TOKEN)return null;
 const stream=channel?'/streams/'+encodeURIComponent(channel):'';
 try{
  const response=await fetch(OME_API_URL+'/v1/stats/current/vhosts/default/apps/live'+stream,{
   headers:{Authorization:'Basic '+Buffer.from(OME_API_TOKEN).toString('base64')},
   signal:AbortSignal.timeout(2000),
  });
  if(!response.ok){await response.body?.cancel();return null;}
  return (await response.json()).response??null;
 }catch{return null;}
}
const activeWindow=5*60000;
let previous:{at:number;idle:number;total:number;sent:number|null;engine?:string}|undefined;
let cached:Promise<Awaited<ReturnType<typeof sampleResources>>>|undefined;
let sampledAt=0;

async function sampleResources(){
 const [engine,disk]=await Promise.all([engineStats(),statfs(dataDir).catch(()=>null)]);
 const now=Date.now();
 let idle=0,total=0;
 for(const {times} of cpus()){
  idle+=times.idle;
  total+=times.user+times.nice+times.sys+times.idle+times.irq;
 }
 const sent=typeof engine?.totalBytesOut==='number'?engine.totalBytesOut:null;
 const elapsed=previous?now-previous.at:0;
 const cpu=previous&&elapsed<=30000&&total>previous.total
  ?Math.min(100,Math.max(0,100*(1-(idle-previous.idle)/(total-previous.total)))):null;
 const throughput=previous&&elapsed>0&&elapsed<=30000&&sent!==null&&previous.sent!==null&&sent>=previous.sent&&engine?.createdTime===previous.engine
  ?8*(sent-previous.sent)*1000/elapsed:null;
 previous={at:now,idle,total,sent,engine:engine?.createdTime};
 return {now,cpu,throughput,sent,llhls:engine?.connections?.llhls??null,engineAvailable:!!engine,
  ram:{used:totalmem()-freemem(),total:totalmem()},
  disk:disk?{used:(disk.blocks-disk.bfree)*disk.bsize,total:disk.blocks*disk.bsize,available:disk.bavail*disk.bsize}:null};
}
export async function monitorSnapshot(){
 const now=Date.now();
 if(!cached||now-sampledAt>=4000){sampledAt=now;cached=sampleResources();}
 const resources=await cached;
 const users=db.prepare(`SELECT u.username,u.role,count(*) AS sessions,max(s.last_seen) AS lastSeen
  FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.last_seen>? AND s.last_seen>? AND s.created_at>?
  GROUP BY u.id ORDER BY lastSeen DESC`).all(now-activeWindow,now-idleLifetime,now-sessionLifetime) as
  {username:string;role:string;sessions:number;lastSeen:number}[];
 const logs=db.prepare(`SELECT a.at,a.event,a.resource,u.username FROM audit a LEFT JOIN users u ON u.id=a.user_id
  ORDER BY a.id DESC LIMIT 60`).all() as {at:number;event:string;resource:string|null;username:string|null}[];
 const runtime=db.prepare(`SELECT c.name,r.state,r.updated_at AS updatedAt FROM playout_runtime r
  JOIN channels c ON c.id=r.channel_id WHERE c.enabled=1 ORDER BY r.updated_at DESC LIMIT 60`).all() as
  {name:string;state:string;updatedAt:number}[];
 return {...resources,users,logs,runtime,viewers:viewerCounts()};
}
