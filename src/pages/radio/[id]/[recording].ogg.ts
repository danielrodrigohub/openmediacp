import type { APIRoute } from 'astro';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { publicRadio, radioDate, radioDays, radioRoot, recordingInfo } from '../../../server/radio';

const noIndex = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

const serve: APIRoute = async ({ params, request }) => {
  const channel = publicRadio(params.id);
  const recording = recordingInfo((params.recording ?? '') + '.ogg');
  if (!channel || !recording || !radioDays().includes(radioDate(recording.start))) {
    return new Response(null, { status: 404, headers: noIndex });
  }
  let file;
  try {
    file = await open(join(radioRoot, channel.id, recording.name), 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404, headers: noIndex });
    throw error;
  }
  try {
    const { size } = await file.stat();
    const headers = new Headers({ ...noIndex, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/ogg' });
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
