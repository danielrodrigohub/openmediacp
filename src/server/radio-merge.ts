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
  recordingsFor,
  resolveRecordingPath,
} from './radio';

const runFile = promisify(execFile);
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

export async function resolveMergedGroupAudio(
  channelId: string,
  fecha: string,
  grupo: string
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

  let filePath = resolved[0].path;
  if (resolved.length > 1) {
    const sig = resolved.map(r => `${r.name}:${r.size}:${r.mtimeMs}`).join('|');
    const cacheKey = createHash('sha256').update(`${channelId}|${group.id}|${sig}`).digest('hex').slice(0, 24);
    try {
      filePath = await buildMergedOgg(channelId, cacheKey, resolved.map(r => r.path));
    } catch {
      filePath = resolved[0].path;
    }
  }

  return { filePath, durationSec: Math.max(1, group.totalSeconds) };
}
