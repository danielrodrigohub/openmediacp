import {mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const dir=process.env.DATA_DIR||'/data';for(const name of ['media','schedules'])mkdirSync(join(dir,name),{recursive:true});
const file=join(dir,'media/emergency.mp4');
const font=existsSync('/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf')?'/usr/share/fonts/ttf-dejavu/DejaVuSans.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
if(!existsSync(file))execFileSync('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=0x14202e:s=1280x720:r=25','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','10','-vf',`drawtext=fontfile=${font}:text='Volvemos en unos momentos':fontcolor=white:fontsize=36:x=(w-tw)/2:y=(h-th)/2`,'-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-g','50','-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',file],{stdio:'inherit'});
console.log('Directorios y cartela de emergencia preparados.');
