import type { APIRoute } from 'astro';
import {audit} from '../../../server/db';
import { logout } from '../../../server/auth.ts';
import { cookieName } from '../../../server/config.ts';
export const POST:APIRoute=({cookies,locals})=>{logout(cookies.get(cookieName)?.value);if(locals.user)audit(locals.user.id,'logout');cookies.delete(cookieName,{path:'/'});return Response.json({redirect:'/login'});};
