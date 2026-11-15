export class InputError extends Error {}
export async function jsonBody(request:Request,max=8192) {
  if(!request.headers.get('content-type')?.startsWith('application/json')) throw new InputError('Envía JSON.');
  const reader=request.body?.getReader();if(!reader) throw new InputError('Solicitud vacía.');
  let size=0; const chunks:Uint8Array[]=[];
  while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>max) { await reader.cancel(); throw new InputError('Solicitud demasiado grande.'); } chunks.push(value); }
  try { const body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body)) throw new Error();return body as Record<string,unknown>; } catch {throw new InputError('Solicitud no válida.');}
}
export function text(value:unknown,max=128) { if(typeof value!=='string'||value.length>max) throw new InputError('Campo no válido.');return value; }
export function apiError(error:unknown) {
  return Response.json({error:error instanceof InputError?error.message:'No se pudo completar la operación.'},{status:error instanceof InputError?400:503});
}
