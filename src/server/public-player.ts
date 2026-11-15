import {db} from './db.ts';

export function publicChannel(id: string | undefined) {
 if (!id || !/^[a-f0-9]{16}$/.test(id)) return undefined;
 return db.prepare('SELECT id,name,enabled FROM channels WHERE id=? AND public_player=1').get(id) as
  {id:string;name:string;enabled:number} | undefined;
}
