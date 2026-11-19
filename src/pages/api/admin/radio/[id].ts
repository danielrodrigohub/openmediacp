import type { APIRoute } from 'astro';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { audit, db } from '../../../../server/db';
import { InputError, apiError, jsonBody } from '../../../../server/http';
import {
  channelPattern,
  fetchStationApiData,
  formatClipFilename,
  matchProgramAt,
  parseChileDateTime,
  parseStationData,
  parseTimeMinutes,
  programsForChannel,
  radioDays,
  radioSettings,
  recordingInfo,
  recordingsFor,
  resolveRecordingPath,
  syncStationApi,
  validateHttpUrl,
} from '../../../../server/radio';
import { resolveMergedGroupAudio } from '../../../../server/radio-merge';

const runFile = promisify(execFile);
const exists = (id: string) => channelPattern.test(id) && !!db.prepare('SELECT 1 FROM channels WHERE id=?').get(id);

export const GET: APIRoute = async ({ params, url, locals, redirect, request }) => {
  if (locals.user?.role !== 'admin') return new Response(null, { status: 403 });
  const id = params.id ?? '';
  if (!exists(id)) return new Response('Canal no disponible.', { status: 404 });

  const action = url.searchParams.get('action');

  // Admin audio preview for any recorded segment or merged emission (works even if unpublished)
  if (action === 'audio' || action === 'merged') {
    let filePath: string | null = null;
    let durationSec = '1.00';
    if (action === 'merged') {
      const fecha = url.searchParams.get('fecha') || '';
      const grupo = url.searchParams.get('grupo') || '';
      const resolved = await resolveMergedGroupAudio(id, fecha, grupo);
      if (resolved) {
        filePath = resolved.filePath;
        durationSec = resolved.durationSec.toFixed(2);
      }
    } else {
      const recName = url.searchParams.get('recording') || '';
      const recording = recordingInfo(recName);
      filePath = recording ? resolveRecordingPath(id, recording.name) : null;
      if (recording) durationSec = Math.max(1, (recording.end - recording.start) / 1000).toFixed(2);
    }
    if (!filePath) return new Response('Grabación no encontrada.', { status: 404 });
    let file;
    try {
      file = await open(filePath, 'r');
      const { size } = await file.stat();
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'audio/ogg',
        'X-Content-Duration': durationSec,
        'Content-Duration': durationSec,
      });
      let start = 0;
      let end = size - 1;
      const range = request.headers.get('range');
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m && (m[1] || m[2])) {
          if (m[1]) {
            start = Number(m[1]);
            if (m[2]) end = Math.min(end, Number(m[2]));
          } else {
            start = Math.max(0, size - Number(m[2]));
          }
        }
        if (!m || (!m[1] && !m[2]) || start > end || !Number.isSafeInteger(start)) {
          await file.close();
          headers.set('Content-Range', `bytes */${size}`);
          return new Response(null, { status: 416, headers });
        }
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      headers.set('Content-Length', String(end - start + 1));
      const stream = file.createReadStream({ start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
    } catch {
      await file?.close();
      return new Response('No se pudo leer el archivo.', { status: 500 });
    }
  }

  // Generate and download custom MP3 clip: YYYY-MM-DD_HH:MM_PROG.MP3
  if (action === 'clip') {
    const date = (url.searchParams.get('date') || '').trim();
    const startStr = (url.searchParams.get('start') || '').trim();
    const endStr = (url.searchParams.get('end') || '').trim();
    const progInput = (url.searchParams.get('program') || '').trim();

    if (!radioDays().includes(date)) {
      return new Response('Selecciona una fecha válida dentro de los últimos 5 días.', { status: 400 });
    }
    const startMs = parseChileDateTime(date, startStr);
    let endMs = parseChileDateTime(date, endStr);
    if (startMs === null || endMs === null) {
      return new Response('Ingresa una hora de inicio y término válidas (HH:MM).', { status: 400 });
    }
    if (endMs <= startMs) {
      endMs += 86_400_000;
    }
    const clipDurationSec = (endMs - startMs) / 1000;
    if (clipDurationSec < 3 || clipDurationSec > 4 * 3600) {
      return new Response('El recorte debe durar entre 3 segundos y 4 horas.', { status: 400 });
    }

    const allRecordings = recordingsFor(id);
    const overlapping = allRecordings
      .filter(rec => rec.end > startMs && rec.start < endMs)
      .map(rec => ({ rec, path: resolveRecordingPath(id, rec.name) }))
      .filter((item): item is { rec: typeof allRecordings[number]; path: string } => Boolean(item.path));

    if (!overlapping.length) {
      return new Response(`No hay audio grabado entre ${startStr} y ${endStr} en la fecha ${date}.`, { status: 404 });
    }

    const programs = programsForChannel(id);
    const matchedProg = matchProgramAt(programs, Math.round((startMs + endMs) / 2));
    const channelRow = db.prepare('SELECT name FROM channels WHERE id=?').get(id) as { name: string } | undefined;
    const programLabel = progInput || matchedProg?.name || channelRow?.name || 'PROGRAMA';
    const filename = formatClipFilename(date, startStr, programLabel);

    const tempFile = join(tmpdir(), `clip-${id}-${randomBytes(8).toString('hex')}.mp3`);
    try {
      const args: string[] = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
      if (overlapping.length === 1) {
        const { rec, path } = overlapping[0];
        const offsetSec = Math.max(0, (startMs - rec.start) / 1000);
        const availEndMs = Math.min(endMs, rec.end);
        const lengthSec = Math.max(1, (availEndMs - Math.max(startMs, rec.start)) / 1000);
        args.push(
          '-ss', offsetSec.toFixed(2),
          '-t', lengthSec.toFixed(2),
          '-i', path,
          '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-metadata', `title=${programLabel} (${date} ${startStr}-${endStr})`,
          tempFile
        );
      } else {
        const filterParts: string[] = [];
        overlapping.forEach(({ rec, path }, idx) => {
          const offsetSec = Math.max(0, (startMs - rec.start) / 1000);
          const availEndMs = Math.min(endMs, rec.end);
          const lengthSec = Math.max(1, (availEndMs - Math.max(startMs, rec.start)) / 1000);
          args.push('-ss', offsetSec.toFixed(2), '-t', lengthSec.toFixed(2), '-i', path);
          filterParts.push(`[${idx}:a:0]`);
        });
        args.push(
          '-filter_complex', `${filterParts.join('')}concat=n=${overlapping.length}:v=0:a=1[outa]`,
          '-map', '[outa]',
          '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          '-metadata', `title=${programLabel} (${date} ${startStr}-${endStr})`,
          tempFile
        );
      }

      await runFile('ffmpeg', args, { timeout: 60_000 });
      const mp3Bytes = await readFile(tempFile);
      audit(locals.user.id, 'radio_clip_created', `${id}:${filename}`);
      const safeAscii = filename.replace(/:/g, '_');
      return new Response(mp3Bytes, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': String(mp3Bytes.byteLength),
          'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    } catch {
      return new Response('No se pudo generar el recorte MP3 con FFmpeg.', { status: 500 });
    } finally {
      await rm(tempFile, { force: true }).catch(() => {});
    }
  }

  return redirect(`/cliente/radio/?channel=${id}`, 303);
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    if (locals.user?.role !== 'admin') return Response.json({ error: 'No tienes acceso.' }, { status: 403 });
    const id = params.id ?? '';
    if (!exists(id)) return Response.json({ error: 'Canal no disponible.' }, { status: 404 });
    const body = await jsonBody(request);
    const action = typeof body.action === 'string' ? body.action : 'settings';
    const on = (value: unknown) => value === 'on' || value === true || value === '1';

    if (action === 'add-program') {
      const name = (typeof body.name === 'string' ? body.name : '').trim().slice(0, 80);
      const startTime = (typeof body.startTime === 'string' ? body.startTime : '').trim();
      const endTime = (typeof body.endTime === 'string' ? body.endTime : '').trim();
      const daysRaw = typeof body.days === 'string' ? body.days : '1,2,3,4,5';
      const overrideMetadata = Number(on(body.overrideMetadata));

      if (!name) throw new InputError('Ingresa el nombre del programa.');
      if (parseTimeMinutes(startTime) === null || parseTimeMinutes(endTime) === null) {
        throw new InputError('Ingresa un horario de inicio y término válido (HH:MM).');
      }
      if (startTime === endTime) {
        throw new InputError('La hora de inicio y de término deben ser distintas.');
      }
      const validDays = [...new Set(
        daysRaw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
      )];
      if (!validDays.length) {
        throw new InputError('Selecciona al menos un día de emisión para el programa.');
      }

      const progId = randomBytes(8).toString('hex');
      db.prepare(`INSERT INTO radio_programs(id,channel_id,name,days,start_time,end_time,override_metadata,created_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        progId,
        id,
        name,
        validDays.join(','),
        startTime.slice(0, 5),
        endTime.slice(0, 5),
        overrideMetadata,
        Date.now()
      );
      audit(locals.user.id, 'radio_program_added', `${id}:${name}`);
      return Response.json({ message: `Programa "${name}" agregado a la programación.` });
    }

    if (action === 'delete-program') {
      const programId = typeof body.programId === 'string' ? body.programId.trim() : '';
      db.prepare('DELETE FROM radio_programs WHERE id=? AND channel_id=?').run(programId, id);
      audit(locals.user.id, 'radio_program_deleted', id);
      return Response.json({ message: 'Programa eliminado.' });
    }

    if (action === 'toggle-program') {
      const programId = typeof body.programId === 'string' ? body.programId.trim() : '';
      const enabled = Number(on(body.overrideMetadata));
      db.prepare('UPDATE radio_programs SET override_metadata=? WHERE id=? AND channel_id=?').run(enabled, programId, id);
      return Response.json({ message: 'Preferencia de reemplazo de metadata actualizada.' });
    }

    let source = (typeof body.source === 'string' ? body.source : '').trim();
    const stationApi = (typeof body.stationApi === 'string' ? body.stationApi : '').trim();
    const recording = Number(on(body.recording));
    const published = Number(on(body.published));

    if (stationApi && !validateHttpUrl(stationApi)) {
      throw new InputError('Usa una URL HTTP o HTTPS válida para la API de la estación.');
    }

    const previous = radioSettings(id);
    let stationData = parseStationData(previous?.station_data);

    if (stationApi) {
      const fetched = await fetchStationApiData(stationApi);
      if (fetched) {
        stationData = fetched.info;
        if (!source && fetched.info.listen_url) {
          source = fetched.info.listen_url;
        }
      }
    } else {
      stationData = {};
      db.prepare('DELETE FROM radio_songs WHERE channel_id=?').run(id);
    }

    if (source) {
      if (!validateHttpUrl(source)) {
        throw new InputError('Usa una URL de audio HTTP o HTTPS válida, sin usuario ni contraseña.');
      }
    } else if (recording) {
      throw new InputError('Ingresa la URL de audio o una API de estación válida para comenzar a grabar.');
    }

    db.prepare(`INSERT INTO radio_channels(channel_id,source_url,station_api_url,station_data,recording,published)
      VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET
      source_url=excluded.source_url,
      station_api_url=excluded.station_api_url,
      station_data=excluded.station_data,
      recording=excluded.recording,
      published=excluded.published,
      state=CASE WHEN radio_channels.source_url<>excluded.source_url OR radio_channels.recording<>excluded.recording
                 THEN 'waiting' ELSE radio_channels.state END,
      updated_at=CASE WHEN radio_channels.source_url<>excluded.source_url OR radio_channels.recording<>excluded.recording
                      THEN 0 ELSE radio_channels.updated_at END`.replace('VALUES(?,?,?,?)', 'VALUES(?,?,?,?,?,?)'))
      .run(id, source, stationApi, JSON.stringify(stationData), recording, published);

    if (stationApi) {
      await syncStationApi(id, stationApi, true);
    }

    audit(locals.user.id, 'radio_settings_updated', id);
    return Response.json({
      message: stationData.name
        ? `Configuración guardada y sincronizada con ${stationData.name}.`
        : 'Configuración de Radio a la carta guardada.',
    });
  } catch (error) {
    return apiError(error);
  }
};
