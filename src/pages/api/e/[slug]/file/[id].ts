import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { readSession } from '@/lib/server/auth';
import { getEventBySlug, getPhotoById } from '@/lib/server/db';
import { apiError } from '@/lib/server/http';

export const GET: APIRoute = async ({ params, cookies, request }) => {
  const slug = params.slug;
  const id = params.id;
  if (!slug || !id) return apiError('Foto inválida', 400);

  const session = await readSession(cookies);
  if (!session) return apiError('Sesión no encontrada. Abre el link del evento.', 401);

  const event = await getEventBySlug(slug);
  if (!event || event.id !== session.eid) return apiError('Evento no encontrado', 404);

  if (event.visibility !== 'open' && session.role !== 'admin') {
    return apiError('Las fotos todavía no están disponibles', 403);
  }

  const photo = await getPhotoById(id);
  if (!photo || photo.event_id !== event.id || photo.status === 'hidden') {
    return apiError('Foto no encontrada', 404);
  }

  const object = await env.ORIGINALS.get(photo.display_key);
  if (!object) return apiError('Foto no encontrada', 404);

  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304 });
  }

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'image/jpeg',
      'content-length': String(object.size),
      'cache-control': 'private, max-age=31536000, immutable',
      etag: object.httpEtag,
      'x-robots-tag': 'noindex',
    },
  });
};
