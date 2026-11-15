import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../src/server/db.ts';
import { channelPattern, radioDate, radioDays, radioRoot, recordingInfo } from '../src/server/radio.ts';

const interval = 5000;
const minimumFree = 512 * 1024 ** 2;
const pendingRoot = join(radioRoot, '.pending');
const attempts = new Map();
const retries = new Map();
let stopping = false;
let lastPurge = 0;
let timer;
mkdirSync(pendingRoot, { recursive: true, mode: 0o700 });

const active = db.prepare(`SELECT c.id,r.source_url FROM channels c JOIN radio_channels r ON r.channel_id=c.id
  WHERE c.enabled=1 AND r.recording=1 AND r.source_url<>''`);
const update = db.prepare(`UPDATE radio_channels SET state=?, updated_at=?
  WHERE channel_id=? AND source_url=? AND recording=1`);

function updateState(channel, state) {
  update.run(state, Date.now(), channel.id, channel.source_url);
}

function entries(path) {
  try { return readdirSync(path, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

function segments(path) {
  return entries(path).filter(entry => entry.isFile() && /^capture-\d{10}\.ogg$/.test(entry.name))
    .map(entry => entry.name).sort();
}

function publish(id, runId, path, name) {
  const file = join(path, name);
  const start = Number(name.slice(8, -4)) * 1000;
  if (radioDate(start) < radioDays().at(-1)) {
    rmSync(file, { force: true });
    return;
  }
  let seconds;
  try {
    seconds = Number(execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
    ], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    seconds = 0;
  }
  if (!(seconds >= 1 && seconds <= 3660)) {
    rmSync(file, { force: true });
    return;
  }
  const directory = join(radioRoot, id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const end = start + Math.round(seconds * 1000);
  renameSync(file, join(directory, `${start}-${end}-${runId}.ogg`));
}

function finalize(attempt) {
  for (const name of segments(attempt.path)) publish(attempt.channel.id, attempt.runId, attempt.path, name);
  rmSync(attempt.path, { recursive: true, force: true });
}

function start(channel) {
  const runId = randomBytes(8).toString('hex');
  const path = join(pendingRoot, `${channel.id}-${runId}`);
  mkdirSync(path, { mode: 0o700 });
  const child = spawn('ffmpeg', [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-rw_timeout', '15000000', '-analyzeduration', '2000000', '-protocol_whitelist', 'http,https,tcp,tls,crypto',
    '-i', channel.source_url, '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
    '-c:a', 'libopus', '-b:a', '82k', '-vbr', 'off', '-ar', '48000', '-ac', '2',
    '-f', 'segment', '-segment_time', '3600', '-segment_atclocktime', '1',
    '-reset_timestamps', '1', '-segment_format', 'ogg', '-segment_format_options', 'flush_packets=1', '-strftime', '1', join(path, 'capture-%s.ogg'),
  ], { env: { ...process.env, TZ: 'UTC' }, stdio: 'ignore' });
  const attempt = { channel, runId, path, child, started: Date.now(), killTimer: undefined };
  attempts.set(channel.id, attempt);
  updateState(channel, 'connecting');
  child.on('error', () => updateState(channel, 'reconnecting'));
  child.once('close', () => {
    clearTimeout(attempt.killTimer);
    attempts.delete(channel.id);
    try { finalize(attempt); }
    catch { console.error(`No se pudo finalizar la grabación del canal ${channel.id}.`); }
    if (!stopping) {
      updateState(channel, 'reconnecting');
      retries.set(channel.id, Date.now() + 10_000);
    } else if (!attempts.size) {
      process.exit(0);
    }
  });
}

function stop(attempt) {
  if (attempt.killTimer) return;
  attempt.child.kill('SIGTERM');
  attempt.killTimer = setTimeout(() => attempt.child.kill('SIGKILL'), 8000);
}

function recover() {
  for (const entry of entries(pendingRoot)) {
    const match = /^([a-f0-9]{16})-([a-f0-9]{16})$/.exec(entry.name);
    if (entry.isDirectory() && match) {
      finalize({ channel: { id: match[1] }, runId: match[2], path: join(pendingRoot, entry.name) });
    }
  }
}

function purge(now) {
  if (now - lastPurge < 60_000) return;
  const oldest = radioDays(now).at(-1);
  for (const entry of entries(radioRoot)) {
    if (!entry.isDirectory() || !channelPattern.test(entry.name)) continue;
    const directory = join(radioRoot, entry.name);
    for (const file of entries(directory)) {
      const recording = file.isFile() && recordingInfo(file.name);
      if (recording && radioDate(recording.start) < oldest) rmSync(join(directory, file.name), { force: true });
    }
  }
  lastPurge = now;
}

function tick() {
  if (stopping) return;
  try {
    const now = Date.now();
    purge(now);
    const { bavail, bsize } = statfsSync(radioRoot);
    const hasSpace = bavail * bsize >= minimumFree;
    const desired = new Map(active.all().filter(channel => channelPattern.test(channel.id)).map(channel => [channel.id, channel]));
    for (const [id, attempt] of attempts) {
      const channel = desired.get(id);
      if (!hasSpace || channel?.source_url !== attempt.channel.source_url) {
        stop(attempt);
        continue;
      }
      const files = segments(attempt.path);
      for (const name of files.slice(0, -1)) publish(id, attempt.runId, attempt.path, name);
      const current = files.at(-1);
      const stat = current && statSync(join(attempt.path, current), { throwIfNoEntry: false });
      if (now - (stat ? stat.mtimeMs : attempt.started) > 120_000) stop(attempt);
      else if (stat && stat.size > 0 && !attempt.killTimer) updateState(channel, 'recording');
    }
    for (const id of retries.keys()) if (!desired.has(id)) retries.delete(id);
    for (const [id, channel] of desired) {
      if (!hasSpace) updateState(channel, 'disk_full');
      else if (!attempts.has(id) && (retries.get(id) ?? 0) <= now) start(channel);
    }
  } catch {
    console.error('No se pudo actualizar el servicio de Radio a la carta.');
  }
  timer = setTimeout(tick, interval);
}

for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
  stopping = true;
  clearTimeout(timer);
  if (!attempts.size) process.exit(0);
  for (const attempt of attempts.values()) stop(attempt);
});

recover();
tick();
