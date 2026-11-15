import type {APIRoute} from 'astro';
import {accessibleChannel} from '../../../../server/channels';
import {engineStats,viewerCounts} from '../../../../server/monitor';
import {apiError} from '../../../../server/http';

export const GET:APIRoute=async ({locals,params})=>{
 try{
  const channel=accessibleChannel(locals.user!,params.id!);
  const engine=channel.enabled?await engineStats(channel.id):null;
  return Response.json({viewers:channel.enabled&&channel.public_player?viewerCounts().get(channel.id)||0:0,
   connections:channel.enabled?engine?.connections?.llhls??null:0});
 }catch(error){return apiError(error);}
};
