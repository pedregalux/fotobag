import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/auth';
import { getEventById, setUploadsOpen, setVisibility, type Visibility } from '@/lib/server/db';
import { apiError, json } from '@/lib/server/http';

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = await requireAdmin(cookies);
  if (!session) return apiError('No autorizado', 401);

  const event = await getEventById(session.eid);
  if (!event) return apiError('Evento no encontrado', 404);

  let body: { uploadsOpen?: unknown; visibility?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError('Cuerpo inválido', 400);
  }

  if (typeof body.uploadsOpen === 'boolean') {
    await setUploadsOpen(event.id, body.uploadsOpen);
  }

  if (typeof body.visibility === 'string') {
    const allowed: Visibility[] = ['open', 'surprise', 'closed'];
    if (!allowed.includes(body.visibility as Visibility)) {
      return apiError('Visibilidad inválida', 400);
    }
    await setVisibility(event.id, body.visibility as Visibility);
  }

  return json({ ok: true });
};
