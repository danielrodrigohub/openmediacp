import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './db.ts';
import { dataDir } from './config.ts';

export const radioRoot = join(dataDir, 'radio');
export const radioTimezone = 'America/Santiago';
export const defaultStationApiUrl = 'https://cp.streamchileno.cl/api/station/4';
export const channelPattern = /^[a-f0-9]{16}$/;
export const recordingPattern = /^(\d{13})-(\d{13})-[a-f0-9]{16}\.ogg$/;
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: radioTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: radioTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const secondFormat = new Intl.DateTimeFormat('es-CL', {
  timeZone: radioTimezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
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
  return db.prepare(`SELECT c.id,c.name,r.source_url,r.station_api_url,r.station_data FROM channels c JOIN radio_channels r ON r.channel_id=c.id
    WHERE c.id=? AND c.enabled=1 AND r.published=1`).get(id) as {
    id: string;
    name: string;
    source_url: string;
    station_api_url: string;
    station_data: string;
  } | undefined;
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

export function radioSecond(timestamp: number) {
  return secondFormat.format(timestamp);
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
    duration= CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE radio_songs.duration END,
    title=excluded.title,
    artist=excluded.artist,
    text=excluded.text,
    art=CASE WHEN excluded.art <> '' THEN excluded.art ELSE radio_songs.art END,
    sh_id=CASE WHEN excluded.sh_id > 0 THEN excluded.sh_id ELSE radio_songs.sh_id END`);

const pruneSongs = db.prepare('DELETE FROM radio_songs WHERE channel_id=? AND played_at < ?');

function cleanString(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
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
    if (!title) return;
    const artist = cleanString(song.artist, 200);
    const text = cleanString(song.text, 300) || (artist ? `${artist} - ${title}` : title);
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
    if (title) {
      info.playing_next = {
        title,
        artist: cleanString(nextSong.artist, 200),
        text: cleanString(nextSong.text, 300) || title,
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
  const apiUrl = (overrideApiUrl ?? current?.station_api_url ?? defaultStationApiUrl).trim();
  if (!apiUrl) return cached;

  if (!force && cached.updated_at && Date.now() - cached.updated_at < 15_000) {
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
  // First prefer a recording where the song starts inside [rec.start, rec.end]
  const direct = recordings.find(rec => songStart >= rec.start && songStart <= rec.end);
  if (direct) {
    return {
      name: direct.name,
      start: direct.start,
      end: direct.end,
      offset: Math.max(0, Math.floor((songStart - direct.start) / 1000)),
    };
  }
  // Or a recording that overlaps the song playback window
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
  const rows = db.prepare(`SELECT played_at,duration,title,artist,text,art,sh_id
    FROM radio_songs WHERE channel_id=? ORDER BY played_at DESC LIMIT 400`).all(channelId) as Omit<RadioSong, 'recording' | 'is_current'>[];

  return rows
    .filter(row => radioDate(row.played_at * 1000) === date)
    .map(row => ({
      ...row,
      is_current: Boolean(currentPlayedAt && row.played_at === currentPlayedAt),
      recording: matchSongRecording(row.played_at, row.duration, recordings),
    }));
}
