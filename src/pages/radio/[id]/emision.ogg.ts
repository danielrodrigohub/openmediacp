import type { APIRoute } from 'astro';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { publicRadio } from '../../../server/radio';
import { resolveMergedGroupAudio } from '../../../server/radio-merge';

const noIndex = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

const serve: APIRoute = async ({ params, request, url }) => {
  const channel = publicRadio(params.id);
  const fecha = url.searchParams.get('fecha') || '';
  const grupo = url.searchParams.get('grupo') || '';
  if (!channel) return new Response(null, { status: 404, headers: noIndex });

  const resolved = await resolveMergedGroupAudio(channel.id, fecha, grupo);
  if (!resolved) return new Response(null, { status: 404, headers: noIndex });

  let file;
  try {
    file = await open(resolved.filePath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404, headers: noIndex });
    throw error;
  }

  try {
    const { size } = await file.stat();
    const durationSec = resolved.durationSec.toFixed(2);
    const headers = new Headers({
      ...noIndex,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'audio/ogg',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'X-Content-Duration': durationSec,
      'Content-Duration': durationSec,
    });
    let start = 0;
    let end = size - 1;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Math.min(end, Number(match[2]));
        } else {
          start = Math.max(0, size - Number(match[2]));
        }
      }
      if (!match || (!match[1] && !match[2]) || start > end || !Number.isSafeInteger(start)) {
        await file.close();
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    if (request.method === 'HEAD' || size === 0) {
      await file.close();
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    const stream = file.createReadStream({ start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch (error) {
    await file.close();
    throw error;
  }
};

export const GET = serve;
export const HEAD = serve;
