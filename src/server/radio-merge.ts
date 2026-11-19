import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  groupRecordingsForDisplay,
  programsForChannel,
  radioDate,
  radioDays,
  radioRoot,
  recordingInfo,
  recordingsFor,
  resolveRecordingPath,
} from './radio';

const runFile = promisify(execFile);
const inFlight = new Map<string, Promise<string>>();

function escapeConcatPath(filePath: string): string {
  return `'${filePath.replace(/'/g, `'\\''`)}'`;
}

async function buildMergedAudio(
  channelId: string,
  cacheKey: string,
  segmentPaths: string[],
  format: 'ogg' | 'mp3'
): Promise<string> {
  const mergedDir = join(radioRoot, '.merged', channelId);
  const targetPath = join(mergedDir, `${cacheKey}.${format}`);
  if (existsSync(targetPath)) return targetPath;

  const existingJob = inFlight.get(targetPath);
  if (existingJob) return existingJob;

  const job = (async () => {
    await mkdir(mergedDir, { recursive: true, mode: 0o700 });
    const token = randomBytes(6).toString('hex');
    const listPath = join(mergedDir, `list-${token}.txt`);
    const tempOut = join(mergedDir, `tmp-${token}.${format}`);
    try {
      if (format === 'mp3') {
        if (segmentPaths.length === 1) {
          await runFile('ffmpeg', [
            '-hide_banner', '-nostdin', '-loglevel', 'error',
            '-i', segmentPaths[0],
            '-vn', '-sn', '-dn',
            '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
            '-y', tempOut,
          ], { timeout: 120_000 });
        } else {
          const listBody = segmentPaths.map(p => `file ${escapeConcatPath(p)}`).join('\n') + '\n';
          await writeFile(listPath, listBody, 'utf8');
          try {
            await runFile('ffmpeg', [
              '-hide_banner', '-nostdin', '-loglevel', 'error',
              '-f', 'concat', '-safe', '0', '-i', listPath,
              '-vn', '-sn', '-dn',
              '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
              '-y', tempOut,
            ], { timeout: 120_000 });
          } catch {
            const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
            const inputs: string[] = [];
            segmentPaths.forEach((p, idx) => {
              args.push('-i', p);
              inputs.push(`[${idx}:a:0]`);
            });
            args.push(
              '-filter_complex', `${inputs.join('')}concat=n=${segmentPaths.length}:v=0:a=1[outa]`,
              '-map', '[outa]',
              '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
              '-y', tempOut,
            );
            await runFile('ffmpeg', args, { timeout: 180_000 });
          }
        }
      } else {
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

export async function resolveMergedGroupAudio(
  channelId: string,
  fecha: string,
  grupo: string,
  format: 'ogg' | 'mp3' = 'ogg'
): Promise<{ filePath: string; durationSec: number } | null> {
  if (!fecha || !grupo || !radioDays().includes(fecha)) return null;

  const programs = programsForChannel(channelId);
  const dayRecordings = recordingsFor(channelId).filter(item => radioDate(item.start) === fecha);
  const groups = groupRecordingsForDisplay(dayRecordings, programs);
  const group = groups.find(g => g.id === grupo || g.segments.some(s => s.name === grupo));
  if (!group || !group.segments.length) return null;

  const resolved: { path: string; size: number; mtimeMs: number; name: string }[] = [];
  for (const seg of group.segments) {
    const filePath = resolveRecordingPath(channelId, seg.name);
    if (!filePath) continue;
    const st = statSync(filePath, { throwIfNoEntry: false });
    if (!st || st.size < 512) continue;
    resolved.push({ path: filePath, size: st.size, mtimeMs: Math.floor(st.mtimeMs), name: seg.name });
  }
  if (!resolved.length) return null;

  if (format === 'ogg' && resolved.length === 1) {
    return { filePath: resolved[0].path, durationSec: Math.max(1, group.totalSeconds) };
  }

  const sig = resolved.map(r => `${r.name}:${r.size}:${r.mtimeMs}`).join('|');
  const cacheKey = createHash('sha256').update(`${channelId}|${group.id}|${format}|${sig}`).digest('hex').slice(0, 24);
  try {
    const filePath = await buildMergedAudio(channelId, cacheKey, resolved.map(r => r.path), format);
    return { filePath, durationSec: Math.max(1, group.totalSeconds) };
  } catch {
    if (format === 'ogg') return { filePath: resolved[0].path, durationSec: Math.max(1, group.totalSeconds) };
    return null;
  }
}

export async function resolveSingleRecordingMp3(
  channelId: string,
  recordingName: string
): Promise<{ filePath: string; durationSec: number } | null> {
  const rec = recordingInfo(recordingName);
  if (!rec || !radioDays().includes(radioDate(rec.start))) return null;
  const srcPath = resolveRecordingPath(channelId, rec.name);
  if (!srcPath) return null;
  const st = statSync(srcPath, { throwIfNoEntry: false });
  if (!st || st.size < 512) return null;
  const sig = `${rec.name}:${st.size}:${Math.floor(st.mtimeMs)}`;
  const cacheKey = createHash('sha256').update(`${channelId}|single|mp3|${sig}`).digest('hex').slice(0, 24);
  try {
    const filePath = await buildMergedAudio(channelId, cacheKey, [srcPath], 'mp3');
    return { filePath, durationSec: Math.max(1, (rec.end - rec.start) / 1000) };
  } catch {
    return null;
  }
}
