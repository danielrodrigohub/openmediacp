import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.ts';
import { dataDir } from './config.ts';

export const radioRoot = join(dataDir, 'radio');
export const radioTimezone = 'America/Santiago';
export const channelPattern = /^[a-f0-9]{16}$/;
export const recordingPattern = /^(\d{13})-(\d{13})-[a-f0-9]{16}\.ogg$/;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: radioTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: radioTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
type RadioSettings = { source_url: string; recording: number; published: number; state: string; updated_at: number };
type Recording = { name: string; start: number; end: number };

export function radioSettings(id: string) {
  return db.prepare('SELECT source_url,recording,published,state,updated_at FROM radio_channels WHERE channel_id=?')
    .get(id) as RadioSettings | undefined;
}

export function publicRadio(id: string | undefined) {
  if (!id || !channelPattern.test(id)) return;
  return db.prepare(`SELECT c.id,c.name FROM channels c JOIN radio_channels r ON r.channel_id=c.id
    WHERE c.id=? AND c.enabled=1 AND r.published=1`).get(id) as { id: string; name: string } | undefined;
}

export function radioDate(timestamp: number) {
  const parts = dateFormat.formatToParts(timestamp);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function radioDays(now = Date.now()) {
  const today = Date.parse(radioDate(now) + 'T12:00:00Z');
  return Array.from({ length: 5 }, (_, i) => new Date(today - i * 86_400_000).toISOString().slice(0, 10));
}

export function radioHour(timestamp: number) {
  return hourFormat.format(timestamp);
}

export function recordingInfo(name: string): Recording | undefined {
  const match = recordingPattern.exec(name);
  if (!match) return;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (end > start && end - start <= 3_660_000) return { name, start, end };
}

export function recordingsFor(id: string) {
  if (!channelPattern.test(id)) return [];
  try {
    const oldest = radioDays().at(-1)!;
    return readdirSync(join(radioRoot, id), { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => recordingInfo(entry.name))
      .filter((item): item is Recording => Boolean(item && radioDate(item.start) >= oldest))
      .sort((a, b) => a.start - b.start);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
