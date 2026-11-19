import type { APIRoute } from 'astro';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import {
  groupRecordingsForDisplay,
  programsForChannel,
  publicRadio,
  radioDate,
  radioDays,
  radioRoot,
  recordingsFor,
  resolveRecordingPath,
} from '../../../server/radio';

const runFile = promisify(execFile);
const noIndex = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const inFlight = new Map<string, Promise<string>>();

function escapeConcatPath(filePath: string): string {
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}

async function buildMergedOgg(channelId: string, cacheKey: string, segmentPaths: string[]): Promise<string> {
  const mergedDir = join(radioRoot, '.merged', channelId);
  const targetPath = join(mergedDir, `${cacheKey}.ogg`);
  if (existsSync(targetPath)) return targetPath;

  const existingJob = inFlight.get(targetPath);
  if (existingJob) return existingJob;

  const job = (async () => {
    await mkdir(mergedDir, { recursive: true, mode: 0o700 });
    const token = randomBytes(6).toString('hex');
    const listPath = join(mergedDir, `list-${token}.txt`);
    const tempOut = join(mergedDir, `tmp-${token}.ogg`);
    try {
      const listBody = segmentPaths.map(p => `file ${escapeConcatPath(p)}`).join('\n') + '\n';
      await writeFile(listPath, listBody, 'utf8');

      try {
        await runFile('ffmpeg', [
          '-hide_banner', '-nostdin', '-loglevel', 'error',
          '-f', 'concat', '-safe', '0', '-i', listPath,
          '-vn', '-sn', '-dn', '-c:a', 'copy',
          '-y', tempOut,
        ], { timeout: 60_000 });
      } catch {
        // Fallback if any cut fragment has mismatched Ogg headers/timestamps
        const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
        const inputs: string[] = [];
        segmentPaths.forEach((p, idx) => {
          args.push('-i', p);
          inputs.push(`[${idx}:a:0]`);
        });
        args.push(
          '-filter_complex', `${inputs.join('')}concat=n=${segmentPaths.length}:v=0:a=1[outa]`,
          '-map', '[outa]',
          '-vn', '-c:a', 'libopus', '-b:a', '82k', '-vbr', 'off', '-ar', '48000', '-ac', '2',
          '-y', tempOut,
        );
        await runFile('ffmpeg', args, { timeout: 120_000 });
      }

      await rename(tempOut, targetPath);
      return targetPath;
    } catch (err) {
      await rm(tempOut, { force: true }).catch(() => {});
      throw err;
    } finally {
      await rm(listPath, { force: true }).catch(() => {});
    }
  })();

  inFlight.set(targetPath, job);
  try {
    return await job;
  } finally {
    inFlight.delete(targetPath);
  }
}

const serve: APIRoute = async ({ params, request, url }) => {
  const channel = publicRadio(params.id);
  const fecha = url.searchParams.get('fecha') || '';
  const grupo = url.searchParams.get('grupo') || '';
  const days = radioDays();

  if (!channel || !fecha || !days.includes(fecha) || !grupo) {
    return new Response(null, { status: 404, headers: noIndex });
  }

  const programs = programsForChannel(channel.id);
  const dayRecordings = recordingsFor(channel.id).filter(item => radioDate(item.start) === fecha);
  const groups = groupRecordingsForDisplay(dayRecordings, programs);
  const group = groups.find(g => g.id === grupo || g.segments.some(s => s.name === grupo));

  if (!group || !group.segments.length) {
    return new Response(null, { status: 404, headers: noIndex });
  }

  const resolved: { path: string; size: number; mtimeMs: number; name: string }[] = [];
  for (const seg of group.segments) {
    const filePath = resolveRecordingPath(channel.id, seg.name);
    if (!filePath) continue;
    const st = statSync(filePath, { throwIfNoEntry: false });
    if (!st || st.size < 512) continue;
    resolved.push({ path: filePath, size: st.size, mtimeMs: Math.floor(st.mtimeMs), name: seg.name });
  }

  if (!resolved.length) {
    return new Response(null, { status: 404, headers: noIndex });
  }

  let filePath = resolved[0].path;
  if (resolved.length > 1) {
    const sig = resolved.map(r => `${r.name}:${r.size}:${r.mtimeMs}`).join('|');
    const cacheKey = createHash('sha256').update(`${channel.id}|${group.id}|${sig}`).digest('hex').slice(0, 24);
    try {
      filePath = await buildMergedOgg(channel.id, cacheKey, resolved.map(r => r.path));
    } catch {
      filePath = resolved[0].path;
    }
  }

  let file;
  try {
    file = await open(filePath, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404, headers: noIndex });
    throw error;
  }

  try {
    const { size } = await file.stat();
    const durationSec = Math.max(1, group.totalSeconds).toFixed(2);
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
