import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { db, audit } from './db.ts';
import { idleLifetime, sessionLifetime, type User } from './config.ts';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve,reject) => {
  scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:192*1024*1024},(error,key)=>error?reject(error):resolve(key));
});
export function validatePassword(password: string) {
  if ([...password].length < 15 || [...password].length > 128 || Buffer.byteLength(password)>512) throw new Error('Usa una contraseña de 15 a 128 caracteres.');
  const common = new Set(['passwordpassword','123456789012345','administrador123','contraseña12345','openmediacp12345']);
  if(common.has(password.toLowerCase())) throw new Error('Elige una contraseña menos predecible.');
}
export async function hashPassword(password: string) {
  validatePassword(password);
  const salt=randomBytes(16).toString('hex');
  return `scrypt$131072$8$1$${salt}$${(await derive(password,salt)).toString('hex')}`;
}
export async function verifyPassword(password:string,stored:string) {
  const parts=stored.split('$');
  const key=await derive(password,parts[4] || '00000000000000000000000000000000');
  const expected=Buffer.from(parts[5] || '00'.repeat(64),'hex');
  return expected.length===key.length && timingSafeEqual(expected,key);
}
// A fixed, invalid hash forces the same expensive comparison for unknown users.
const dummy=`scrypt$131072$8$1$00000000000000000000000000000000$${'00'.repeat(64)}`;
let activeLogins=0;
export function throttle(bucket:string,limit=8,windowMs=15*60*1000) {
  const now=Date.now();
  db.prepare('DELETE FROM attempts WHERE expires<?').run(now);
  db.prepare(`INSERT INTO attempts(bucket,count,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1`).run(bucket,now+windowMs);
  return (db.prepare('SELECT count FROM attempts WHERE bucket=?').get(bucket) as {count:number}).count<=limit;
}
export async function login(username:string,password:string,ip:string) {
  const name=username.trim().toLowerCase();
  const byAccount=throttle(`account:${digest(name)}`,8);
  const byIp=throttle(`ip:${digest(ip)}`,30);
  if(!byAccount || !byIp || activeLogins>=2) return {error:'Demasiados intentos. Inténtalo más tarde.',status:429} as const;
  activeLogins++;
  try {
    const row=db.prepare('SELECT * FROM users WHERE username=?').get(name) as (User & {password:string}) | undefined;
    const valid=await verifyPassword(password,row?.password||dummy);
    if(!row || !valid) { audit(null,'login_failed'); return {error:'Usuario o contraseña incorrectos.',status:401} as const; }
    const token=randomToken(); const now=Date.now();
    db.prepare('DELETE FROM sessions WHERE created_at<? OR last_seen<?').run(now-sessionLifetime,now-idleLifetime);
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),row.id,now,now);
    db.prepare('DELETE FROM attempts WHERE bucket=?').run(`account:${digest(name)}`);
    audit(row.id,'login');
    return {token,user:{id:row.id,username:row.username,role:row.role}};
  } finally { activeLogins--; }
}
export function sessionUser(token:string|undefined,touch=true):User|null {
  if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const now=Date.now();
  const row=db.prepare(`SELECT u.id,u.username,u.role FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token=? AND s.created_at>? AND s.last_seen>?`).get(digest(token),now-sessionLifetime,now-idleLifetime) as User|undefined;
  if(!row) return null;
  if(touch)db.prepare('UPDATE sessions SET last_seen=? WHERE token=?').run(now,digest(token));
  return row;
}
export function logout(token:string|undefined) { if(token) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token)); }
export async function createUser(username:string,password:string,role:'admin'|'client') {
  const normalized=username.trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) throw new Error('Usuario: 3 a 64 letras, números, puntos o guiones.');
  const hash=await hashPassword(password);
  const result=db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run(normalized,hash,role);
  audit(null,'user_created',String(result.lastInsertRowid));
  return Number(result.lastInsertRowid);
}
