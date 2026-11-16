import type { APIRoute } from 'astro';
import {
  defaultStationApiUrl,
  publicRadio,
  radioDate,
  radioDays,
  radioHour,
  recordingsFor,
  songsForDate,
  syncStationApi,
} from '../../../server/radio';

const noIndex = { 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

export const GET: APIRoute = async ({ params, url }) => {
  const channel = publicRadio(params.id);
  if (!channel) {
    return new Response(JSON.stringify({ error: 'No disponible' }), {
      status: 404,
      headers: { ...noIndex, 'Content-Type': 'application/json' },
    });
  }

  const station = await syncStationApi(channel.id, channel.station_api_url || defaultStationApiUrl);
  const recordings = recordingsFor(channel.id);
  const days = radioDays();
  const requested = url.searchParams.get('fecha');
  const date = requested && days.includes(requested) ? requested : days[0];
  const selections = recordings.filter(item => radioDate(item.start) === date);
  const songs = songsForDate(channel.id, date, selections, station.now_playing?.played_at);
  const radioPath = `/radio/${channel.id}/`;
  const timeRange = (start: number, end: number) => `${radioHour(start)} – ${radioHour(end)}`;

  return new Response(
    JSON.stringify({
      station: {
        name: station.name || channel.name,
        description: station.description || '',
        url: station.url || '',
        listenUrl: station.listen_url || channel.source_url || '',
        hlsUrl: station.hls_url || '',
        listeners: station.listeners ?? null,
        isLive: Boolean(station.is_live),
        streamerName: station.streamer_name || '',
        nowPlaying: station.now_playing || null,
        playingNext: station.playing_next || null,
      },
      date,
      recordings: selections.map(rec => ({
        name: rec.name,
        url: radioPath + rec.name,
        start: rec.start,
        end: rec.end,
        range: timeRange(rec.start, rec.end),
      })),
      songs: songs.map(song => ({
        playedAt: song.played_at,
        time: radioHour(song.played_at * 1000),
        duration: song.duration,
        title: song.title,
        artist: song.artist,
        art: song.art,
        isCurrent: Boolean(song.is_current),
        recording: song.recording
          ? {
              name: song.recording.name,
              url: radioPath + song.recording.name,
              range: timeRange(song.recording.start, song.recording.end),
              offset: song.recording.offset,
              start: song.recording.start,
              end: song.recording.end,
            }
          : null,
      })),
    }),
    {
      status: 200,
      headers: { ...noIndex, 'Content-Type': 'application/json' },
    }
  );
};
