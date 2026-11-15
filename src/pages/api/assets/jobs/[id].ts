import type {APIRoute} from 'astro';
import {getUploadJob} from '../../../../server/upload-jobs.ts';
export const GET:APIRoute=({params,locals})=>{
 const job=getUploadJob(params.id||'',locals.user!.id,locals.user!.role==='admin');
 return job?Response.json(job):Response.json({error:'Preparación no disponible. Reintenta el archivo.'},{status:404});
};
