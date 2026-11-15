import type {APIRoute} from 'astro';
import {publicChannel} from '../../server/public-player';
import {recordViewer} from '../../server/monitor';
import {jsonBody,InputError,apiError} from '../../server/http';

export const POST:APIRoute=async ({request,params})=>{
 const channel=publicChannel(params.id);
 if(!channel?.enabled)return new Response(null,{status:404});
 try{
  const {id,playing}=await jsonBody(request,256);
  if(typeof id!=='string'||!/^([a-f0-9]{32})$/.test(id)||typeof playing!=='boolean')throw new InputError('Estado de reproducción inválido.');
  recordViewer(channel.id,id,playing);
  return new Response(null,{status:204});
 }catch(error){return apiError(error);}
};
