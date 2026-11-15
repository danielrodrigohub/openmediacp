import {db} from './db.ts';

export type ExistingUpload={id:string};

// Legacy assets have no source hash: their name in the same folder is the only
// reliable duplicate signal. New assets also match by content hash so a renamed
// copy can be skipped after transfer.
export function findDuplicateUpload(owner:number,channel:string,folder:string,name:string,sourceBytes:number,sha256?:string|null) {
  return db.prepare(`SELECT id FROM assets
    WHERE owner_id=? AND (channel_id IS NULL OR channel_id=?) AND folder=? AND
      ((? IS NOT NULL AND source_sha256=?) OR (name=? AND (source_bytes IS NULL OR source_bytes=?)))
    ORDER BY created_at LIMIT 1`).get(owner,channel,folder,sha256??null,sha256??null,name,sourceBytes) as ExistingUpload|undefined;
}
