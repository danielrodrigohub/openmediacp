import {mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
mkdirSync('release',{recursive:true});
execFileSync('tar',['-czf','release/openmediacp-vps.tar.gz','--exclude=deploy/certs','--exclude=deploy/generated','package.json','package-lock.json','astro.config.mjs','tsconfig.json','Dockerfile','.dockerignore','compose.yaml','compose.local.yaml','tests','.github','src','public','scripts','deploy','docs','README.md','DESIGN.md','SECURITY.md','.env.example'],{stdio:'inherit'});
console.log('release/openmediacp-vps.tar.gz');
