import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const cache=new Map<string,{start:number;end:number;signature:string;fps:number;duration:number}>();
export async function clipClock(path:string){
 const cached=cache.get(path);if(cached)return cached;
 const meta=JSON.parse((await run('ffprobe',['-v','error','-show_streams','-show_data','-of','json',path],{timeout:15000,maxBuffer:1024**2})).stdout);
 const video=meta.streams.find((s:{codec_type:string})=>s.codec_type==='video'),audio=meta.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
 if(video?.codec_name!=='h264'||audio?.codec_name!=='aac')throw new Error('Incompatible stream codecs');
 const [n,d]=String(video.r_frame_rate).split('/').map(Number);const fps=n/d;
 const signature=JSON.stringify([video.width,video.height,video.r_frame_rate,video.profile,audio.sample_rate,audio.channels,createHash('sha256').update(String(video.extradata)+String(audio.extradata)).digest('hex')]);
 const packets=(await run('ffprobe',['-v','error','-show_packets','-show_entries','packet=pts_time,dts_time,duration_time','-of','csv=p=0',path],{timeout:30000,maxBuffer:16*1024**2})).stdout;
 let start=Infinity,end=-Infinity;
 for(const line of packets.split('\n')){const [pts,dts,duration]=line.split(',').map(Number);if(!Number.isFinite(dts)||!Number.isFinite(pts)||!Number.isFinite(duration)||duration<=0)continue;start=Math.min(start,dts);end=Math.max(end,dts+duration,pts+duration);}
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('No usable packet clock');
 const result={start,end,signature,fps,duration:Number.isFinite(Number(video.duration))&&Number(video.duration)>0?Number(video.duration):end-start};cache.set(path,result);return result;
}
