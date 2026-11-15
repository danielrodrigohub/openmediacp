import type { APIRoute } from 'astro';
import { audit, db } from '../../../../server/db';
import { InputError } from '../../../../server/http';
import { channelPattern } from '../../../../server/radio';

export const GET: APIRoute = async ({ params, locals, redirect }) => {
  if (locals.user?.role !== 'admin') return new Response(null, { status: 403 });
  const id = params.id ?? '';
  if (!channelPattern.test(id) || !db.prepare('SELECT 1 FROM channels WHERE id=?').get(id)) {
    return new Response('Canal no disponible.', { status: 404 });
  }
  return redirect(`/cliente/radio/?channel=${id}`, 303);
};

export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  if (locals.user?.role !== 'admin') return new Response(null, { status: 403 });
  const id = params.id ?? '';
  if (!channelPattern.test(id) || !db.prepare('SELECT 1 FROM channels WHERE id=?').get(id)) {
    return new Response('Canal no disponible.', { status: 404 });
  }
  const destination = `/cliente/radio/?channel=${id}`;
  try {
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) {
      throw new InputError('Formulario no válido.');
    }
    const reader = request.body?.getReader();
    if (!reader) throw new InputError('Formulario vacío.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) {
        await reader.cancel();
        throw new InputError('Formulario demasiado grande.');
      }
      chunks.push(value);
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const source = (form.get('source') ?? '').trim();
    const recording = Number(form.get('recording') === 'on');
    const published = Number(form.get('published') === 'on');
    if (source) {
      let url: URL | undefined;
      try { url = new URL(source); } catch {}
      if (source.length > 2048 || !url || !['http:', 'https:'].includes(url.protocol) ||
          url.username || url.password || url.hash || /[\u0000-\u0020\u007f]/.test(source)) {
        throw new InputError('Usa una URL de audio HTTP o HTTPS válida, sin usuario ni contraseña.');
      }
    } else if (recording) {
      throw new InputError('Ingresa la URL de audio para comenzar a grabar.');
    }
    db.prepare(`INSERT INTO radio_channels(channel_id,source_url,recording,published)
      VALUES(?,?,?,?) ON CONFLICT(channel_id) DO UPDATE SET
      source_url=excluded.source_url, recording=excluded.recording, published=excluded.published,
      state=CASE WHEN radio_channels.source_url<>excluded.source_url OR radio_channels.recording<>excluded.recording
                 THEN 'waiting' ELSE radio_channels.state END,
      updated_at=CASE WHEN radio_channels.source_url<>excluded.source_url OR radio_channels.recording<>excluded.recording
                      THEN 0 ELSE radio_channels.updated_at END`).run(id, source, recording, published);
    audit(locals.user.id, 'radio_settings_updated', id);
    return redirect(destination + '&saved=1', 303);
  } catch (error) {
    if (error instanceof InputError) return redirect(destination + '&error=' + encodeURIComponent(error.message), 303);
    throw error;
  }
};
