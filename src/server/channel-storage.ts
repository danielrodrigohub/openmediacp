import {db} from './db.ts';
import {storageQuota,type Channel} from './config.ts';
import {InputError} from './http.ts';

export const bytesPerGiB=1024**3;
export function channelQuota(channel:Pick<Channel,'storage_quota_bytes'>){
 return channel.storage_quota_bytes??storageQuota;
}
export function parseChannelQuota(body:Record<string,unknown>){
 if(body.storageMode==='streaming')return 0;
 if(body.storageMode!=='storage'||typeof body.quotaGiB!=='string'||!/^\d+(\.\d+)?$/.test(body.quotaGiB))throw new InputError('Indica una cuota en GiB.');
 const amount=Number(body.quotaGiB);
 if(!Number.isFinite(amount)||amount<0.0625||amount>10000)throw new InputError('La cuota debe estar entre 0,0625 y 10.000 GiB.');
 return Math.round(amount*bytesPerGiB);
}
export function channelStorageUsage(channel:Pick<Channel,'id'|'owner_id'>){
 return db.prepare('SELECT count(*) AS total,coalesce(sum(bytes),0) AS bytes FROM assets WHERE owner_id=? AND (channel_id IS NULL OR channel_id=?)')
  .get(channel.owner_id,channel.id) as {total:number;bytes:number};
}
