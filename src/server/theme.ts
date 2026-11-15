import { createHash } from 'node:crypto';
export const themeScript = `try{const t=localStorage.getItem('om-theme')||'system';document.documentElement.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t}catch{}`;
export const themeHash = 'sha256-'+createHash('sha256').update(themeScript).digest('base64');
