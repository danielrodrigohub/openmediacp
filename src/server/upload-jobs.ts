import {db} from './db.ts';
// Persist completion so a lost HTTP response does not require another transfer.
db.exec(`CREATE TABLE IF NOT EXISTS upload_jobs(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,state TEXT NOT NULL,result TEXT,created_at INTEGER NOT NULL)`);
db.prepare("UPDATE upload_jobs SET state='error',result=? WHERE state='processing'").run(JSON.stringify({error:'El servidor se reinició mientras preparaba el video. Reintenta este archivo.'}));
db.prepare("DELETE FROM upload_jobs WHERE state!='processing' AND created_at<?").run(Date.now()-86400000);
export function beginUploadJob(id:string,userId:number){db.prepare('INSERT INTO upload_jobs(id,user_id,state,created_at) VALUES(?,?,?,?)').run(id,userId,'processing',Date.now());}
export function finishUploadJob(id:string,result:unknown,error=false){db.prepare('UPDATE upload_jobs SET state=?,result=? WHERE id=?').run(error?'error':'done',JSON.stringify(result),id);}
export function getUploadJob(id:string,userId:number,admin=false){
 const job=db.prepare('SELECT user_id,state,result FROM upload_jobs WHERE id=?').get(id) as {user_id:number;state:string;result:string|null}|undefined;
 if(!job||!admin&&job.user_id!==userId)return null;
 return {state:job.state,...(job.result?JSON.parse(job.result):{})};
}
