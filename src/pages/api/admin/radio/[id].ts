import type { APIRoute } from 'astro';
import { audit, db } from '../../../../server/db';
import { InputError, apiError, jsonBody } from '../../../../server/http';
import { channelPattern, fetchStationApiData, parseStationData, radioSettings, syncStationApi, validateHttpUrl } from '../../../../server/radio';

const exists = (id: string) => channelPattern.test(id) && !!db.prepare('SELECT 1 FROM channels WHERE id=?').get(id);

// Direct visits (refresh, bookmarked URL) go back to the settings page instead of a 404.
export const GET: APIRoute = async ({ params, locals, redirect }) => {
  if (locals.user?.role !== 'admin') return new Response(null, { status: 403 });
  const id = params.id ?? '';
  if (!exists(id)) return new Response('Canal no disponible.', { status: 404 });
  return redirect(`/cliente/radio/?channel=${id}`, 303);
};

// Saved via fetch + JSON (same pattern as the rest of the panel). A classic HTML form POST
// is sent with "Origin: null" because of Referrer-Policy: no-referrer, and the CSRF check rejects it.
export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    if (locals.user?.role !== 'admin') return Response.json({ error: 'No tienes acceso.' }, { status: 403 });
    const id = params.id ?? '';
    if (!exists(id)) return Response.json({ error: 'Canal no disponible.' }, { status: 404 });
    const body = await jsonBody(request);
    let source = (typeof body.source === 'string' ? body.source : '').trim();
    const stationApi = (typeof body.stationApi === 'string' ? body.stationApi : '').trim();
    const on = (value: unknown) => value === 'on' || value === true || value === '1';
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
    }

    if (source) {
      if (!validateHttpUrl(source)) {
        throw new InputError('Usa una URL de audio HTTP o HTTPS válida, sin usuario ni contraseña.');
      }
    } else if (recording) {
      throw new InputError('Ingresa la URL de audio o una API de estación válida para comenzar a grabar.');
    }

    db.prepare(`INSERT INTO radio_channels(channel_id,source_url,station_api_url,station_data,recording,published)
      VALUES(?,?,?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET
      source_url=excluded.source_url,
      station_api_url=excluded.station_api_url,
      station_data=excluded.station_data,
      recording=excluded.recording,
      published=excluded.published,
      state=CASE WHEN radio_channels.source_url<>excluded.source_url OR radio_channels.recording<>excluded.recording
                 THEN 'waiting' ELSE radio_channels.state END,
      updated_at=CASE WHEN radio_channels.source_url<>excluded.source_url OR radio_channels.recording<>excluded.recording
                      THEN 0 ELSE radio_channels.updated_at END`)
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
