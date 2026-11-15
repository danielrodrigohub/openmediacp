import type { APIRoute } from 'astro';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataDir } from '../../../server/config';
import { db } from '../../../server/db';

const run = promisify(execFile);
const thumbnails = new Map<string, Promise<void>>();
let queue = Promise.resolve();

async function thumbnail(id: string, source: string, duration: number) {
 const directory = join(dataDir, 'thumbnails');
 const path = join(directory, id + '.jpg');
 if (await stat(path).then(s => s.size > 0, () => false)) return path;

 let job = thumbnails.get(id);
 if (!job) {
  if (thumbnails.size >= 40) return null;
  const temporary = path + '.tmp.jpg';
  job = queue.then(async () => {
   try {
    await mkdir(directory, { recursive: true });
    const offset = Math.max(0, Math.min(5, (duration || 0) / 10));
    await run('nice', ['-n', '15', 'ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file',
     '-threads', '1', '-ss', String(offset), '-i', source, '-map', '0:v:0', '-frames:v', '1',
     '-vf', 'scale=320:180:force_original_aspect_ratio=decrease', '-q:v', '4', '-threads', '1', '-y', temporary],
    { timeout: 6000, maxBuffer: 64 * 1024 });
    await rename(temporary, path);
   } finally {
    await unlink(temporary).catch(() => {});
    thumbnails.delete(id);
   }
  });
  thumbnails.set(id, job);
  queue = job.catch(() => {});
 }
 await job;
 return path;
}

export const GET: APIRoute = async ({ locals, params, request, url }) => {
 const id = params.id || '';
 const missing = () => new Response(null, { status: 404 });
 if (!locals.user || !/^[a-f0-9]{32}$/.test(id)) return missing();
 const asset = db.prepare('SELECT owner_id, filename, duration FROM assets WHERE id=?').get(id) as
  { owner_id: number; filename: string; duration: number } | undefined;
 if (!asset || (locals.user.role !== 'admin' && asset.owner_id !== locals.user.id) ||
     !/^[a-f0-9]{32}\.mp4$/.test(asset.filename)) return missing();

 let path = join(dataDir, 'media', asset.filename);
 const source = await stat(path).catch(() => null);
 if (!source?.isFile() || !source.size) return missing();
 const image = url.searchParams.has('thumbnail');
 if (image) {
  const preview = await thumbnail(id, path, asset.duration).catch(() => null);
  if (!preview) return missing();
  path = preview;
 }

 const size = image ? (await stat(path)).size : source.size;
 const headers = new Headers({ 'Content-Type': image ? 'image/jpeg' : 'video/mp4' });
 let start = 0, end = size - 1, status = 200;
 if (!image) {
  headers.set('Accept-Ranges', 'bytes');
  const range = request.headers.get('range');
  if (range) {
   const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
   const invalid = () => new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
   if (!parts || (!parts[1] && !parts[2])) return invalid();
   if (parts[1]) {
    start = Number(parts[1]);
    if (parts[2]) end = Math.min(end, Number(parts[2]));
   } else {
    const suffix = Number(parts[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
    start = Math.max(0, size - suffix);
   }
   if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return invalid();
   status = 206;
   headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
 }
 headers.set('Content-Length', String(end - start + 1));
 const body = request.method === 'HEAD' ? null :
  Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
 return new Response(body, { status, headers });
};
export const HEAD = GET;
