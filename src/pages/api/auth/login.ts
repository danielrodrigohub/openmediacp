import type { APIRoute } from 'astro';
import { login } from '../../../server/auth.ts';
import { jsonBody, text, apiError } from '../../../server/http.ts';
import { cookieName, production } from '../../../server/config.ts';
export const POST:APIRoute=async ({request,cookies,clientAddress})=>{
  try {
    const body=await jsonBody(request,2048);
    const proxyKey=process.env.PROXY_SECRET;
    const ip=proxyKey&&request.headers.get('x-om-proxy-key')===proxyKey?request.headers.get('x-om-client-ip')||clientAddress:clientAddress;
    const result=await login(text(body.username,64),text(body.password,512),ip);
    if('error' in result) return Response.json({error:result.error},{status:result.status});
    cookies.set(cookieName,result.token,{httpOnly:true,secure:production,sameSite:'strict',path:'/',maxAge:8*60*60});
    return Response.json({redirect:result.user.role==='admin'?'/admin/':'/cliente/'});
  } catch(error) { return apiError(error); }
};
