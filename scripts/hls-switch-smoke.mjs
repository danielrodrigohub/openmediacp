// Run inside the playout container: isolated synthetic channel, never alters OBS.
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {db} from '../src/server/db.ts';
import {digest} from '../src/server/auth.ts';
import {workerKey} from '../src/server/watermark.ts';
import {rm,readFile} from 'node:fs/promises';
const id=randomBytes(8).toString('hex'),secret=randomBytes(24).toString('hex');
const children=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const endpoint=`http://hls:8090/live/${id}/llhls.m3u8`;
function ff(args){const p=spawn('ffmpeg',['-nostdin','-v','warning',...args],{stdio:['ignore','ignore','pipe']});children.push(p);let errors='';p.stderr.on('data',d=>{errors+=String(d)});p.report=()=>errors;return p;}
async function waitSource(expected){const started=Date.now();for(let i=0;i<50;i++){const r=await fetch(endpoint);await r.body?.cancel();if(r.ok&&r.headers.get('x-openbroadcast-source')===expected){console.log('SOURCE',expected,'after',Date.now()-started,'ms');return;}await sleep(1000);}throw Error('Source timeout: '+expected);}
const owner=db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id;
let reader;
try {
 db.prepare('INSERT INTO channels(id,name,owner_id,ingest_hash,created_at,watermark) VALUES(?,?,?,?,?,?)').run(id,'Prueba temporal HLS',owner,digest(secret),Date.now(),JSON.stringify({enabled:false}));
 const autoName='auto_'+id;
 ff(['-re','-stream_loop','-1','-i','/data/media/emergency.mp4','-c','copy','-f','flv',`rtmp://ome:1935/live/${autoName}?key=${workerKey(autoName)}`]);
 await waitSource('auto');await sleep(8000);
 reader=ff(['-threads','1','-live_start_index','-1','-i',endpoint,'-t','120','-progress','/tmp/hls-smoke-progress','-f','null','-']);
 await sleep(8000);
 const live=ff(['-re','-f','lavfi','-i','testsrc2=size=320x180:rate=15','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-c:v','libx264','-threads','1','-preset','ultrafast','-tune','zerolatency','-g','30','-bf','0','-c:a','aac','-b:a','64k','-f','flv',`rtmp://ome:1935/live/in_${id}?key=${secret}`]);
 await waitSource('in');
 for(let i=0;i<20;i++){const r=await fetch(endpoint);await r.body?.cancel();if(r.headers.get('x-openbroadcast-source')!=='in')throw Error('Live interrupted');await sleep(1000);}
 live.kill('SIGTERM');await waitSource('auto');await sleep(40000);
 const manifest=await (await fetch(endpoint)).text();
 if(!manifest.includes('#EXT-X-DISCONTINUITY')&&!/#EXT-X-DISCONTINUITY-SEQUENCE:[1-9]\d*/.test(manifest))throw Error('Missing discontinuity tracking');
 if(reader.exitCode!==null)throw Error('External reader stopped prematurely');
 const progress=await readFile('/tmp/hls-smoke-progress','utf8');const times=[...progress.matchAll(/out_time_us=(\d+)/g)];if(Number(times.at(-1)?.[1])<50000000)throw Error('External reader did not advance for 50s');
 reader.kill('SIGINT');await sleep(2000);
 const errors=reader.report();
 if(/corrupt|Invalid data|error while decoding|non monotonically|non-existing|concealing|error while filtering|Error during demuxing/i.test(errors))throw Error('Decode errors: '+errors.slice(-2000));
 console.log('PASS: AutoDJ → live (20s stable) → AutoDJ; continuous external HLS decoding, distinct resolutions, no decode errors.');
 console.log('READER_WARNINGS',errors.slice(-1000));
} finally {
 for(const p of children){p.kill('SIGTERM');setTimeout(()=>{if(p.exitCode===null)p.kill('SIGKILL')},1500).unref();}
 db.prepare('DELETE FROM channels WHERE id=?').run(id);db.prepare('DELETE FROM playout_runtime WHERE channel_id=?').run(id);
 await rm(`/data/schedules/${id}.sch`,{force:true});
 console.log('Cleaned test channel',id);
}
