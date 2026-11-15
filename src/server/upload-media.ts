// Compare the mapped audio/video tracks, not a container duration that may
// include edit offsets, chapter tracks or metadata excluded from the output.
type Track={codec_type?:string;duration?:string|number;sample_rate?:string;channels?:number;codec_name?:string;bit_rate?:string|number};
type Probe={streams?:Track[];format?:{duration?:string|number;start_time?:string|number}};
const positive=(n:unknown)=>Number.isFinite(Number(n))&&Number(n)>0?Number(n):0;
export function mediaDuration(info:Probe){
 const durations=['video','audio'].map(kind=>positive(info.streams?.find(t=>t.codec_type===kind)?.duration));
 return Math.max(...durations)||Math.max(0,positive(info.format?.duration)-Math.max(0,Number(info.format?.start_time)||0));
}
export function incompleteTracks(source:Probe,output:Probe){
 return ['video','audio'].some(kind=>{
  const before=source.streams?.find(t=>t.codec_type===kind),after=output.streams?.find(t=>t.codec_type===kind);
  if(!after)return true;
  const expected=positive(before?.duration),actual=positive(after.duration);
  return expected&&actual?actual+0.5<expected:mediaDuration(output)+0.5<mediaDuration(source);
 });
}
export function copyCompatibleAudio(audio:Track){
 return audio.codec_name==='aac'&&['44100','48000'].includes(String(audio.sample_rate))&&audio.channels===2&&positive(audio.bit_rate)>0&&positive(audio.bit_rate)<=128000;
}
