import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.ts';
import { dataDir } from './config.ts';

export const radioRoot = join(dataDir, 'radio');
export const pendingRadioRoot = join(radioRoot, '.pending');
export const radioTimezone = 'America/Santiago';
export const defaultStationApiUrl = 'https://cp.streamchileno.cl/api/station/4';
export const channelPattern = /^[a-f0-9]{16}$/;
export const recordingPattern = /^(\d{13})-(\d{13})-([a-f0-9]{16})\.ogg$/;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: radioTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: radioTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export type StationSongNow = {
  played_at: number;
  duration: number;
  elapsed: number;
  title: string;
  artist: string;
  text: string;
  art: string;
};

export type StationInfo = {
  id?: number | string;
  name?: string;
  shortcode?: string;
  description?: string;
  listen_url?: string;
  hls_url?: string;
  url?: string;
  public_player_url?: string;
  bitrate?: number;
  format?: string;
  listeners?: number;
  is_live?: boolean;
  streamer_name?: string;
  now_playing?: StationSongNow;
  playing_next?: {
    title: string;
    artist: string;
    text: string;
    art: string;
  };
  updated_at?: number;
};

export type RadioSettings = {
  source_url: string;
  station_api_url: string;
  station_data: string;
  recording: number;
  published: number;
  state: string;
  updated_at: number;
};

export type Recording = { name: string; start: number; end: number };

export type RadioSong = {
  played_at: number;
  duration: number;
  title: string;
  artist: string;
  text: string;
  art: string;
  sh_id: number;
  is_current?: boolean;
  recording?: {
    name: string;
    start: number;
    end: number;
    offset: number;
  };
};

export function parseStationData(raw?: string | null): StationInfo {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as StationInfo : {};
  } catch {
    return {};
  }
}

export function radioSettings(id: string) {
  return db.prepare('SELECT source_url,station_api_url,station_data,recording,published,state,updated_at FROM radio_channels WHERE channel_id=?')
    .get(id) as RadioSettings | undefined;
}

export function publicRadio(id: string | undefined) {
  if (!id || !channelPattern.test(id)) return;
  const row = db.prepare(`SELECT c.id,c.name,r.source_url,r.station_api_url,r.station_data FROM channels c JOIN radio_channels r ON r.channel_id=c.id
    WHERE c.id=? AND c.enabled=1 AND r.published=1`).get(id) as {
    id: string;
    name: string;
    source_url: string;
    station_api_url: string;
    station_data: string;
  } | undefined;
  if (!row) return;
  if (row.station_api_url === defaultStationApiUrl && !row.name.toLowerCase().includes('riquelme')) {
    try {
      db.prepare("UPDATE radio_channels SET station_api_url='', station_data='{}' WHERE channel_id=?").run(row.id);
      db.prepare('DELETE FROM radio_songs WHERE channel_id=?').run(row.id);
    } catch {}
    row.station_api_url = '';
    row.station_data = '{}';
  }
  return row;
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

export function resolveRecordingPath(channelId: string, recordingName: string): string | null {
  if (!channelPattern.test(channelId)) return null;
  const match = recordingPattern.exec(recordingName);
  if (!match) return null;
  const directPath = join(radioRoot, channelId, recordingName);
  if (existsSync(directPath)) return directPath;

  const start = Number(match[1]);
  const runId = match[3];
  const startSec = Math.floor(start / 1000);
  const pendingPath = join(pendingRadioRoot, `${channelId}-${runId}`, `capture-${startSec}.ogg`);
  if (existsSync(pendingPath)) return pendingPath;
  return null;
}

export function recordingsFor(id: string) {
  if (!channelPattern.test(id)) return [];
  const oldest = radioDays().at(-1)!;
  const items: Recording[] = [];

  try {
    for (const entry of readdirSync(join(radioRoot, id), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const info = recordingInfo(entry.name);
      if (info && radioDate(info.start) >= oldest) items.push(info);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // Also include active in-progress capture segments from .pending so current-hour audio is immediately available
  try {
    const prefix = `${id}-`;
    for (const dirEntry of readdirSync(pendingRadioRoot, { withFileTypes: true })) {
      if (!dirEntry.isDirectory() || !dirEntry.name.startsWith(prefix)) continue;
      const runId = dirEntry.name.slice(prefix.length);
      if (!/^[a-f0-9]{16}$/.test(runId)) continue;
      const runDir = join(pendingRadioRoot, dirEntry.name);
      for (const fileEntry of readdirSync(runDir, { withFileTypes: true })) {
        if (!fileEntry.isFile()) continue;
        const capMatch = /^capture-(\d{10})\.ogg$/.exec(fileEntry.name);
        if (!capMatch) continue;
        const start = Number(capMatch[1]) * 1000;
        if (radioDate(start) < oldest) continue;
        const stat = statSync(join(runDir, fileEntry.name), { throwIfNoEntry: false });
        if (!stat || stat.size < 1024) continue;
        const end = Math.min(start + 3_660_000, Math.max(start + 2000, Math.floor(stat.mtimeMs)));
        if (end > start) {
          items.push({ name: `${start}-${end}-${runId}.ogg`, start, end });
        }
      }
    }
  } catch {}

  return items.sort((a, b) => a.start - b.start);
}

export function validateHttpUrl(value: string): URL | undefined {
  if (!value || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return;
    return url;
  } catch {
    return;
  }
}

export function deriveNowPlayingUrl(stationApiUrl: string): string | null {
  const match = /^(https?:\/\/[^/]+)\/api\/(?:station|nowplaying)\/([^/?#]+)\/?$/i.exec(stationApiUrl.trim());
  if (!match) return null;
  return `${match[1]}/api/nowplaying/${match[2]}`;
}

const insertSong = db.prepare(`INSERT INTO radio_songs(channel_id,played_at,duration,title,artist,text,art,sh_id)
  VALUES(?,?,?,?,?,?,?,?)
  ON CONFLICT(channel_id,played_at) DO UPDATE SET
    duration=CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE radio_songs.duration END,
    title=excluded.title,
    artist=excluded.artist,
    text=excluded.text,
    art=CASE WHEN excluded.art <> '' THEN excluded.art ELSE radio_songs.art END,
    sh_id=CASE WHEN excluded.sh_id > 0 THEN excluded.sh_id ELSE radio_songs.sh_id END`);

const pruneSongs = db.prepare('DELETE FROM radio_songs WHERE channel_id=? AND played_at < ?');

function cleanString(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanArtist(value: unknown): string {
  const raw = cleanString(value, 200);
  if (/^(?:unknown\s*artist|desconocido|sin\s*artista)$/i.test(raw)) return '';
  return raw;
}

export function isSystemOrAdTrack(title: string, artist: string): boolean {
  const t = title.trim();
  const a = artist.trim();
  if (!t) return true;
  if (/(?:^|[_-\s])(?:pub|publicidad|comercial|jingle|spot|promo|cuña|ofertas)(?:[_-\s]|$)/i.test(t)) return true;
  if (/^(?:a\d{3,5}_|rrc[-_]|hth\d+|conexion|desconexion|temperaturaregional|temperatura|hora|1350\s*am|radio\s*riquelme)/i.test(t)) return true;
  if (/radioriquelme/i.test(t)) return true;
  if (/^(?:ca\d{2,4}|\d{1,4})$/i.test(a)) return true;
  if (/^(?:rrc|radio\s*riquelme)$/i.test(a) && (t.includes('_') || /1350|coquimbo/i.test(t))) return true;
  if ((!a || /^unknown\s*artist$/i.test(a)) && (!t.includes(' ') || t.includes('_'))) return true;
  if (t.length > 45 && !t.includes(' ')) return true;
  return false;
}

function cleanUrl(value: unknown): string {
  const raw = cleanString(value, 2048);
  return validateHttpUrl(raw) ? raw : '';
}

export async function fetchStationApiData(stationApiUrl: string): Promise<{ info: StationInfo; songs: Omit<RadioSong, 'recording' | 'is_current'>[] } | null> {
  const valid = validateHttpUrl(stationApiUrl);
  if (!valid) return null;
  const nowPlayingUrl = deriveNowPlayingUrl(valid.href);
  let payload: Record<string, any> | null = null;

  if (nowPlayingUrl) {
    try {
      const res = await fetch(nowPlayingUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json === 'object' && !Array.isArray(json)) payload = json;
      }
    } catch {}
  }

  if (!payload) {
    try {
      const res = await fetch(valid.href, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json === 'object' && !Array.isArray(json)) payload = json;
      }
    } catch {}
  }

  if (!payload) return null;

  const stationObj = (payload.station && typeof payload.station === 'object') ? payload.station : payload;
  const mounts = Array.isArray(stationObj.mounts) ? stationObj.mounts : [];
  const defaultMount = mounts.find((m: any) => m?.is_default && cleanUrl(m?.url)) || mounts.find((m: any) => cleanUrl(m?.url));
  const listenUrl = cleanUrl(stationObj.listen_url) || cleanUrl(defaultMount?.url);
  const hlsUrl = stationObj.hls_enabled && cleanUrl(stationObj.hls_url) ? cleanUrl(stationObj.hls_url) : '';

  const info: StationInfo = {
    id: typeof stationObj.id === 'number' || typeof stationObj.id === 'string' ? stationObj.id : undefined,
    name: cleanString(stationObj.name, 120) || undefined,
    shortcode: cleanString(stationObj.shortcode, 120) || undefined,
    description: cleanString(stationObj.description, 400) || undefined,
    listen_url: listenUrl || undefined,
    hls_url: hlsUrl || undefined,
    url: cleanUrl(stationObj.url) || undefined,
    public_player_url: cleanUrl(stationObj.public_player_url) || undefined,
    bitrate: typeof defaultMount?.bitrate === 'number' ? defaultMount.bitrate : undefined,
    format: cleanString(defaultMount?.format, 20) || undefined,
    listeners: typeof payload.listeners?.current === 'number'
      ? payload.listeners.current
      : typeof defaultMount?.listeners?.current === 'number'
        ? defaultMount.listeners.current
        : undefined,
    is_live: Boolean(payload.live?.is_live),
    streamer_name: cleanString(payload.live?.streamer_name, 120) || undefined,
    updated_at: Date.now(),
  };

  const songs: Omit<RadioSong, 'recording' | 'is_current'>[] = [];
  const pushSong = (entry: any, isNow = false) => {
    if (!entry || typeof entry !== 'object') return;
    const song = entry.song && typeof entry.song === 'object' ? entry.song : null;
    if (!song) return;
    const playedAt = Number(entry.played_at);
    if (!Number.isFinite(playedAt) || playedAt <= 0) return;
    const title = cleanString(song.title, 200) || cleanString(song.text, 200);
    const rawArtist = cleanString(song.artist, 200);
    if (!title || isSystemOrAdTrack(title, rawArtist)) return;
    const artist = cleanArtist(rawArtist);
    const text = artist ? `${artist} - ${title}` : title;
    const art = cleanUrl(song.art);
    const duration = Math.max(0, Math.round(Number(entry.duration) || 0));
    const shId = Math.max(0, Math.round(Number(entry.sh_id) || 0));
    songs.push({ played_at: Math.round(playedAt), duration, title, artist, text, art, sh_id: shId });
    if (isNow) {
      info.now_playing = {
        played_at: Math.round(playedAt),
        duration,
        elapsed: Math.max(0, Math.round(Number(entry.elapsed) || 0)),
        title,
        artist,
        text,
        art,
      };
    }
  };

  if (payload.now_playing) pushSong(payload.now_playing, true);
  if (Array.isArray(payload.song_history)) {
    for (const item of payload.song_history) pushSong(item, false);
  }
  if (payload.playing_next?.song) {
    const nextSong = payload.playing_next.song;
    const title = cleanString(nextSong.title, 200) || cleanString(nextSong.text, 200);
    const rawArtist = cleanString(nextSong.artist, 200);
    if (title && !isSystemOrAdTrack(title, rawArtist)) {
      const artist = cleanArtist(rawArtist);
      info.playing_next = {
        title,
        artist,
        text: artist ? `${artist} - ${title}` : title,
        art: cleanUrl(nextSong.art),
      };
    }
  }

  return { info, songs };
}

export async function syncStationApi(channelId: string, overrideApiUrl?: string, force = false): Promise<StationInfo> {
  if (!channelPattern.test(channelId)) return {};
  const current = radioSettings(channelId);
  const cached = parseStationData(current?.station_data);
  const apiUrl = (overrideApiUrl ?? current?.station_api_url ?? '').trim();
  if (!apiUrl) return cached;

  if (!force && cached.updated_at && Date.now() - cached.updated_at < 5_000) {
    return cached;
  }

  const fetched = await fetchStationApiData(apiUrl);
  if (!fetched) return cached;

  const { info, songs } = fetched;
  try {
    for (const song of songs) {
      insertSong.run(channelId, song.played_at, song.duration, song.title, song.artist, song.text, song.art, song.sh_id);
    }
    const minTimestamp = Math.floor((Date.now() - 6 * 86_400_000) / 1000);
    pruneSongs.run(channelId, minTimestamp);

    if (current) {
      const nextSource = current.source_url || info.listen_url || '';
      db.prepare('UPDATE radio_channels SET station_data=?, source_url=? WHERE channel_id=?')
        .run(JSON.stringify(info), nextSource, channelId);
    }
  } catch {}

  return info;
}

export function matchSongRecording(playedAtSeconds: number, durationSeconds: number, recordings: Recording[]) {
  const songStart = playedAtSeconds * 1000;
  const songEnd = songStart + Math.max(30_000, (durationSeconds || 180) * 1000);
  const direct = recordings.find(rec => songStart >= rec.start && songStart <= rec.end);
  if (direct) {
    return {
      name: direct.name,
      start: direct.start,
      end: direct.end,
      offset: Math.max(0, Math.floor((songStart - direct.start) / 1000)),
    };
  }
  const overlap = recordings.find(rec => rec.start <= songEnd && rec.end >= songStart);
  if (overlap) {
    return {
      name: overlap.name,
      start: overlap.start,
      end: overlap.end,
      offset: Math.max(0, Math.floor((songStart - overlap.start) / 1000)),
    };
  }
  return undefined;
}

export function songsForDate(channelId: string, date: string, recordings: Recording[] = [], currentPlayedAt?: number): RadioSong[] {
  if (!channelPattern.test(channelId)) return [];
  const settings = radioSettings(channelId);
  if (!settings?.station_api_url?.trim()) {
    try { db.prepare('DELETE FROM radio_songs WHERE channel_id=?').run(channelId); } catch {}
    return [];
  }
  const rows = db.prepare(`SELECT played_at,duration,title,artist,text,art,sh_id
    FROM radio_songs WHERE channel_id=? ORDER BY played_at DESC LIMIT 400`).all(channelId) as Omit<RadioSong, 'recording' | 'is_current'>[];

  return rows
    .filter(row => radioDate(row.played_at * 1000) === date && !isSystemOrAdTrack(row.title, row.artist))
    .map(row => ({
      ...row,
      artist: cleanArtist(row.artist),
      is_current: Boolean(currentPlayedAt && row.played_at === currentPlayedAt),
      recording: matchSongRecording(row.played_at, row.duration, recordings),
    }));
}

export type RadioProgram = {
  id: string;
  channel_id: string;
  name: string;
  days: string; // e.g. '1,2,3,4,5' (0=Dom, 1=Lun, ..., 6=Sáb)
  start_time: string; // 'HH:MM'
  end_time: string;   // 'HH:MM'
  override_metadata: number; // 1 or 0
  created_at: number;
};

const weekdayEnMap: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const chileFullPartsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: radioTimezone,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function chileClock(timestampMs = Date.now()) {
  const parts = chileFullPartsFormat.formatToParts(timestampMs);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const weekday = weekdayEnMap[get('weekday')] ?? 0;
  const hour = Number(get('hour')) || 0;
  const minute = Number(get('minute')) || 0;
  const second = Number(get('second')) || 0;
  return {
    weekday,
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute,
    second,
    minutes: hour * 60 + minute,
    hhmm: `${get('hour')}:${get('minute')}`,
  };
}

export function parseTimeMinutes(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseChileDateTime(dateStr: string, timeStr: string): number | null {
  const dMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const tMatch = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(timeStr.trim());
  if (!dMatch || !tMatch) return null;
  const year = Number(dMatch[1]);
  const month = Number(dMatch[2]);
  const day = Number(dMatch[3]);
  const hour = Number(tMatch[1]);
  const minute = Number(tMatch[2]);
  const second = Number(tMatch[3] || '0');

  const approxUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const local = chileClock(approxUtc);
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const offsetMs = localAsUtc - approxUtc;
  return approxUtc - offsetMs;
}

export function programsForChannel(channelId: string): RadioProgram[] {
  if (!channelPattern.test(channelId)) return [];
  return db.prepare(`SELECT id,channel_id,name,days,start_time,end_time,override_metadata,created_at
    FROM radio_programs WHERE channel_id=? ORDER BY start_time, name`).all(channelId) as RadioProgram[];
}

export function matchProgramAt(programs: RadioProgram[], timestampMs = Date.now()): RadioProgram | undefined {
  if (!programs.length) return;
  const { weekday, minutes } = chileClock(timestampMs);
  const prevWeekday = (weekday + 6) % 7;

  for (const prog of programs) {
    const startMin = parseTimeMinutes(prog.start_time);
    const endMin = parseTimeMinutes(prog.end_time);
    if (startMin === null || endMin === null) continue;
    const daySet = new Set(
      prog.days
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
    );
    if (endMin > startMin) {
      if (daySet.has(weekday) && minutes >= startMin && minutes < endMin) return prog;
    } else if (endMin < startMin) {
      // Overnight program (e.g. 22:00 to 02:00)
      if (daySet.has(weekday) && minutes >= startMin) return prog;
      if (daySet.has(prevWeekday) && minutes < endMin) return prog;
    }
  }
  return undefined;
}

export function matchProgramForRecording(programs: RadioProgram[], startMs: number, endMs: number): RadioProgram | undefined {
  if (!programs.length) return;
  const midMs = Math.round((startMs + endMs) / 2);
  return matchProgramAt(programs, midMs) || matchProgramAt(programs, startMs + 60_000);
}

export type GroupedRecording = {
  id: string;
  start: number;
  end: number;
  totalSeconds: number;
  programId: string;
  programName: string;
  segments: Recording[];
};

export function groupRecordingsForDisplay(recordings: Recording[], programs: RadioProgram[]): GroupedRecording[] {
  if (!recordings.length) return [];
  const sorted = [...recordings].sort((a, b) => a.start - b.start);
  const groups: GroupedRecording[] = [];

  for (const rec of sorted) {
    const prog = matchProgramForRecording(programs, rec.start, rec.end);
    const progId = prog?.id || '';
    const progName = prog?.name || '';
    const segDur = Math.max(1, (rec.end - rec.start) / 1000);
    const prev = groups[groups.length - 1];

    let canMerge = false;
    if (prev) {
      if (progId && prev.programId === progId) {
        // Merge consecutive segments of the same program (allow reconnect gaps up to 45 min)
        canMerge = rec.start - prev.end <= 45 * 60_000;
      } else if (!progId && !prev.programId) {
        // Merge unlabelled stream-reconnect fragments within the same clock hour
        const prevHour = chileClock(prev.start);
        const curHour = chileClock(rec.start);
        canMerge = prevHour.year === curHour.year
          && prevHour.month === curHour.month
          && prevHour.day === curHour.day
          && prevHour.hour === curHour.hour;
      }
    }

    if (canMerge && prev) {
      prev.end = Math.max(prev.end, rec.end);
      prev.totalSeconds += segDur;
      prev.segments.push(rec);
    } else {
      groups.push({
        id: rec.name,
        start: rec.start,
        end: rec.end,
        totalSeconds: segDur,
        programId: progId,
        programName: progName,
        segments: [rec],
      });
    }
  }

  return groups;
}

export function isMetadataStuck(nowPlaying?: StationSongNow | null): boolean {
  if (!nowPlaying) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - (nowPlaying.played_at || 0);
  if (nowPlaying.duration > 0 && ageSec > nowPlaying.duration + 90) return true;
  if (ageSec > 12 * 60) return true;
  return false;
}

export function resolveLiveDisplayTitle(station: StationInfo, programs: RadioProgram[], nowMs = Date.now()): {
  title: string;
  activeProgram?: RadioProgram;
  overridden: boolean;
} {
  const activeProgram = matchProgramAt(programs, nowMs);
  const stuck = isMetadataStuck(station.now_playing);
  const rawTrack = station.now_playing
    ? `${station.now_playing.artist ? station.now_playing.artist + ' — ' : ''}${station.now_playing.title}`
    : '';

  if (activeProgram && (activeProgram.override_metadata === 1 || stuck || !rawTrack)) {
    return {
      title: activeProgram.name,
      activeProgram,
      overridden: true,
    };
  }

  return {
    title: rawTrack || activeProgram?.name || 'Señal en directo',
    activeProgram,
    overridden: false,
  };
}

export function formatProgramDaysLabel(daysStr: string): string {
  const names: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };
  const days = daysStr
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  const key = [...new Set(days)].sort().join(',');
  if (key === '1,2,3,4,5') return 'Lunes a Viernes';
  if (key === '0,6') return 'Sábado y Domingo';
  if (key === '0,1,2,3,4,5,6') return 'Todos los días';
  return [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).map(d => names[d]).join(', ') || 'Sin días';
}

export function sanitizeProgramSlug(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return normalized || 'PROGRAMA';
}

export function formatClipFilename(dateStr: string, startTimeStr: string, programName: string): string {
  const hhmm = startTimeStr.trim().slice(0, 5);
  const prog = sanitizeProgramSlug(programName);
  return `${dateStr}_${hhmm}_${prog}.MP3`;
}
