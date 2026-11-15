import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaDuration,incompleteTracks,copyCompatibleAudio} from '../src/server/upload-media.ts';
const probe=(duration,container=duration)=>({format:{duration:container},streams:[{codec_type:'video',duration},{codec_type:'audio',duration}]});
test('ignores unrelated container duration when mapped tracks are complete',()=>{
 const source=probe(240,245),output=probe(240);
 assert.equal(mediaDuration(source),240);assert.equal(incompleteTracks(source,output),false);
});
test('rejects genuinely truncated video or audio even with a valid container duration',()=>{
 assert.equal(incompleteTracks(probe(240),probe(200)),true);
 const output=probe(240);output.streams[1].duration=100;
 assert.equal(incompleteTracks(probe(240),output),true);
 assert.equal(incompleteTracks(probe(240),{streams:[{codec_type:'video',duration:240}]}),true);
});
test('copies compatible 44.1 and 48 kHz AAC without changing the bitrate limit',()=>{
 const audio={codec_name:'aac',sample_rate:'44100',channels:2,bit_rate:128000};
 assert.equal(copyCompatibleAudio(audio),true);assert.equal(copyCompatibleAudio({...audio,sample_rate:'48000'}),true);
 assert.equal(copyCompatibleAudio({...audio,bit_rate:192000}),false);assert.equal(copyCompatibleAudio({...audio,codec_name:'mp3'}),false);
});
