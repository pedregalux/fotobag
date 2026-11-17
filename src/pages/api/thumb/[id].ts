import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getPhotoById } from '@/lib/server/db';
import { apiError } from '@/lib/server/http';

/**
 * Fallback de miniaturas para desarrollo local o cuando todavía no hay un
 * dominio público apuntando al bucket. En producción lo normal es que
 * PUBLIC_THUMBS_BASE esté configurado y esta ruta ni se use.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id) return apiError('Foto inválida', 400);

  const photo = await getPhotoById(id);
  if (!photo) return apiError('Foto no encontrada', 404);

  const object = await env.THUMBS.get(photo.thumb_key);
  if (!object) return apiError('Miniatura no encontrada', 404);

  if (request.headers.get('if-none-match') === object.httpEtag) {
    return new Response(null, { status: 304 });
  }

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'image/jpeg',
      'content-length': String(object.size),
      'cache-control': 'public, max-age=31536000, immutable',
      etag: object.httpEtag,
    },
  });
};
