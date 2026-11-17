import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/auth';
import { getEventById } from '@/lib/server/db';
import { apiError } from '@/lib/server/http';
import { eventUrl, qrSvg } from '@/lib/server/qr';

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await requireAdmin(cookies);
  if (!session) return apiError('No autorizado', 401);

  const event = await getEventById(session.eid);
  if (!event) return apiError('Evento no encontrado', 404);

  const svg = qrSvg(eventUrl(url.origin, event.slug));

  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'content-disposition': `attachment; filename="qr-${event.slug}.svg"`,
      'cache-control': 'no-store',
    },
  });
};
