import { resolve } from 'node:path';
export const dataDir = resolve(process.env.DATA_DIR || './data');
export const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:4321';
export const production = origin.startsWith('https://');
export const cookieName = production ? '__Host-om_session' : 'om_session';
export const mediaOrigin = process.env.MEDIA_ORIGIN || 'https://stream.example.test';
export const sessionLifetime = 8 * 60 * 60 * 1000;
export const idleLifetime = 30 * 60 * 1000;
export type User = { id: number; username: string; role: 'admin' | 'client' };
export type Channel = { id: string; name: string; owner_id: number; enabled: number; public_player: number; storage_quota_bytes: number | null; created_at: number; fallback: string; autodj: string; watermark: string };

export const storageQuota=Math.max(64*1024**2,Number(process.env.STORAGE_QUOTA_BYTES)||5*1024**3);
export const maxOutputBytes=Math.max(32*1024**2,Number(process.env.MAX_OUTPUT_BYTES)||1024**3);
