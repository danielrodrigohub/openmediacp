import type { APIRoute } from 'astro';
import { createUser } from '../../../server/auth.ts';
import { jsonBody,text,InputError,apiError } from '../../../server/http.ts';
export const POST:APIRoute=async ({request})=>{try {const body=await jsonBody(request,2048);let id;try{id=await createUser(text(body.username,64),text(body.password,512),'client');}catch{throw new InputError('Revisa el usuario y usa una contraseña única de 15 a 128 caracteres. El nombre puede estar ocupado.');}return Response.json({message:'Cliente creado.',id});}catch(error){return apiError(error);}};
