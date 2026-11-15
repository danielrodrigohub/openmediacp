import type {APIRoute} from 'astro';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {accessibleChannel} from '../../../server/channels.ts';
import {dataDir} from '../../../server/config.ts';
import {db} from '../../../server/db.ts';
export const GET:APIRoute=async({locals,params,url})=>{try{const channel=accessibleChannel(locals.user!,params.id!);const id=url.searchParams.get('logo')||'';if(!/^[a-f0-9]{32}$/.test(id)||!db.prepare('SELECT id FROM logos WHERE id=? AND owner_id=?').get(id,channel.owner_id))return new Response(null,{status:404});return new Response(new Uint8Array(await readFile(join(dataDir,'logos',id+'.png'))),{headers:{'Content-Type':'image/png'}});}catch{return new Response(null,{status:404});}};
