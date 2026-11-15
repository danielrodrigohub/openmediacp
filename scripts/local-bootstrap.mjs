import {randomBytes} from 'node:crypto';
import {createUser} from '../src/server/auth.ts';
import {createChannel} from '../src/server/channels.ts';
import {db} from '../src/server/db.ts';
const password=randomBytes(24).toString('base64url');
let admin=db.prepare("SELECT id,username,role FROM users WHERE role='admin' LIMIT 1").get();
if(!admin){const id=await createUser('admin',password,'admin');admin={id,username:'admin',role:'admin'};console.log(JSON.stringify({username:'admin',password}));}
if(!db.prepare('SELECT id FROM channels LIMIT 1').get()){const {channel,key}=createChannel('Canal de pruebas',admin.id,admin);console.log(JSON.stringify({channel:channel.id,key:`in_${channel.id}?key=${key}`}));}
