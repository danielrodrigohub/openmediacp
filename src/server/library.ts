import {db} from './db.ts';
import {InputError} from './http.ts';
export function normalizeFolder(path:string) {
 const clean=path.normalize('NFC').replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
 if(!clean)return '';
 const parts=clean.split('/');
 if(clean.length>240||parts.length>8||parts.some(p=>!p.trim()||p==='.'||p==='..'||p.length>80||/[\x00-\x1f]/.test(p)))throw new InputError('Carpeta no válida.');
 return parts.join('/');
}
export function ensureFolder(owner:number,path:string){const parts=normalizeFolder(path).split('/').filter(Boolean);for(let i=1;i<=parts.length;i++)db.prepare('INSERT OR IGNORE INTO folders VALUES(?,?)').run(owner,parts.slice(0,i).join('/'));}
