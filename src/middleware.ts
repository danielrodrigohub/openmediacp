import { defineMiddleware } from 'astro:middleware';
import { sessionUser } from './server/auth.ts';
import { db } from './server/db.ts';
import { cookieName, origin, production, type Channel } from './server/config.ts';
export const onRequest=defineMiddleware(async (context,next)=>{
  const path=context.url.pathname;
  const internal=path==='/internal/admission';
  if(!['GET','HEAD','OPTIONS'].includes(context.request.method) && !internal) {
    if(context.request.headers.get('origin')!==origin) return new Response('Solicitud no permitida.',{status:403});
  }
  const polling=/^\/api\/channels\/[a-f0-9]{16}\/audience\/?$/.test(path)||
    (/^\/admin\/monitor\/?$/.test(path)&&context.url.searchParams.get('refresh')==='1');
  context.locals.user=path.startsWith('/viewers/')?null:sessionUser(context.cookies.get(cookieName)?.value,!polling);
  context.locals.channels=[];context.locals.channel=null;
  const protectedPath=path==='/cuenta' || path.startsWith('/admin') || path.startsWith('/cliente') || path.startsWith('/api/') && !path.startsWith('/api/auth/login');
  if(protectedPath && !context.locals.user) return path.startsWith('/api/') ? Response.json({error:'Inicia sesión.'},{status:401}) : context.redirect('/login',303);
  const adminPath=path.startsWith('/admin') || path.startsWith('/api/admin/');
  if(adminPath && context.locals.user?.role!=='admin') return new Response('No tienes acceso a esta sección.',{status:403});
  if(context.locals.user) {
    context.locals.channels=(context.locals.user.role==='admin'?db.prepare('SELECT * FROM channels ORDER BY created_at').all():db.prepare('SELECT * FROM channels WHERE owner_id=? ORDER BY created_at').all(context.locals.user.id)) as Channel[];
    const selected=context.url.searchParams.get('channel');
    context.locals.channel=selected?context.locals.channels.find(c=>c.id===selected)||null:context.locals.channels[0]||null;
    if(selected && !context.locals.channel) return new Response('Canal no disponible.',{status:404});
  }
  const response=await next();
  response.headers.set('X-Content-Type-Options','nosniff');
  const embeddable=response.ok && /^\/embed\/[a-f0-9]{16}\/?$/.test(path);
  if(!embeddable)response.headers.set('X-Frame-Options','DENY');
  response.headers.set('Referrer-Policy','no-referrer');
  response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(production) response.headers.set('Strict-Transport-Security','max-age=31536000');
  response.headers.set('Cache-Control','no-store');
  // Astro/SSR scripts are self-hosted; theme init receives an explicit hash.
  const { themeHash }=await import('./server/theme.ts');
  const media=new URL(process.env.MEDIA_ORIGIN||origin).origin;
  const radioPage=path.startsWith('/radio/');
  const imgSrc=radioPage?"'self' data: blob: https:":"'self' data: blob:";
  const mediaSrc=radioPage?`'self' blob: https: http: ${media}`:`'self' blob: ${media}`;
  response.headers.set('Content-Security-Policy',`default-src 'self'; script-src 'self' '${themeHash}'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src ${imgSrc}; media-src ${mediaSrc}; connect-src 'self' ${media}; worker-src 'self' blob:; frame-ancestors ${embeddable?'*':"'none'"}; base-uri 'self'; form-action 'self'; object-src 'none'`);
  return response;
});
