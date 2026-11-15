import type { APIRoute } from 'astro';
import { db,audit } from '../../../server/db.ts';
import { hashPassword,verifyPassword,throttle } from '../../../server/auth.ts';
import { cookieName } from '../../../server/config.ts';
import { jsonBody,text,InputError,apiError } from '../../../server/http.ts';
export const POST:APIRoute=async ({locals,request,cookies})=>{
 try {
  if(!throttle(`password:${locals.user!.id}`,5)) return Response.json({error:'Espera antes de volver a intentarlo.'},{status:429});
  const body=await jsonBody(request,2048);const row=db.prepare('SELECT password FROM users WHERE id=?').get(locals.user!.id) as {password:string};
  if(!await verifyPassword(text(body.current,512),row.password)) throw new InputError('La contraseña actual no es correcta.');
  let hash;try {hash=await hashPassword(text(body.password,512));} catch(error) {throw new InputError((error as Error).message);}
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash,locals.user!.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(locals.user!.id);
  audit(locals.user!.id,'password_changed');cookies.delete(cookieName,{path:'/'});return Response.json({redirect:'/login'});
 } catch(error){return apiError(error);}
};
