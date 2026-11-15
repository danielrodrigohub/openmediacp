export type SignalSnapshot={checkedAt:number;output:'available'|'absent'|'unknown';input:'available'|'absent'|'unknown';source:string;resolution:string|null;fps:number|null;bitrate:number|null;codec:string|null};
export async function signalSnapshot(id:string):Promise<SignalSnapshot>{
 const result:SignalSnapshot={checkedAt:Date.now(),output:'unknown',input:'unknown',source:'Sin datos',resolution:null,fps:null,bitrate:null,codec:null};
 if(!process.env.OME_API_URL||!process.env.OME_API_TOKEN)return result;
 const base=process.env.OME_API_URL,headers={Authorization:'Basic '+Buffer.from(process.env.OME_API_TOKEN).toString('base64')};
 const read=async(name:string)=>{try{const r=await fetch(`${base}/v1/vhosts/default/apps/live/streams/${name}`,{headers,signal:AbortSignal.timeout(2000)});return {status:r.status,data:r.ok?(await r.json()).response:null};}catch{return {status:0,data:null};}};
 const [output,input]=await Promise.all([read(id),read('in_'+id)]);
 result.checkedAt=Date.now();result.output=output.status===200?'available':output.status===404?'absent':'unknown';result.input=input.status===200?'available':input.status===404?'absent':'unknown';
 // Scheduled currentItem may describe the requested live input even during fallback.
 // Stream existence and a running AutoDJ are not proof of the selected source.
 const tracks=output.data?.outputs?.find((o:{name:string})=>o.name===id)?.tracks||[];
 const video=tracks.find((t:{type:string})=>t.type==='Video')?.video,audio=tracks.find((t:{type:string})=>t.type==='Audio')?.audio;
 if(video?.codecStatus==='Ready'){
  if(Number(video.width)>0&&Number(video.height)>0)result.resolution=`${video.width} × ${video.height}`;
  if(Number.isFinite(video.framerate)&&video.framerate>0)result.fps=video.framerate;
  result.codec=typeof video.codec==='string'?video.codec:null;
 }
 if(Number.isFinite(video?.bitrateAvg)&&Number.isFinite(audio?.bitrateAvg))result.bitrate=video.bitrateAvg+audio.bitrateAvg;
 return result;
}
export const checkedTime=(value:number)=>new Date(value).toLocaleTimeString('es-CL',{timeZone:'America/Santiago'});
