import {existsSync,writeFileSync,readFileSync,appendFileSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(!existsSync('.env.local-docker'))writeFileSync('.env.local-docker',`OME_API_TOKEN=${randomBytes(32).toString('hex')}\nOME_ADMISSION_SECRET=${randomBytes(32).toString('hex')}\n`,{mode:0o600});
console.log('Configuración local lista. El entorno del VPS no fue modificado.');

if(!readFileSync('.env.local-docker','utf8').includes('OME_WORKER_SECRET='))appendFileSync('.env.local-docker',`OME_WORKER_SECRET=${randomBytes(32).toString('hex')}\n`,{mode:0o600});

chmodSync('.env.local-docker',0o600);
