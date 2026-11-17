import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/auth';
import { deletePhotoRow, getPhotoById, setPhotoStatus } from '@/lib/server/db';
import { apiError, json } from '@/lib/server/http';
import { deleteObjects, deleteThumbObjects } from '@/lib/server/r2';

async function ownedPhoto(id: string, eventId: string) {
  const photo = await getPhotoById(id);
  if (!photo || photo.event_id !== eventId) return null;
  return photo;
}

export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const session = await requireAdmin(cookies);
  if (!session) return apiError('No autorizado', 401);

  const id = params.id;
  if (!id) return apiError('Foto inválida', 400);

  const photo = await ownedPhoto(id, session.eid);
  if (!photo) return apiError('Foto no encontrada', 404);

  let status = '';
  try {
    const body = (await request.json()) as { status?: unknown };
    status = String(body.status ?? '');
  } catch {
    return apiError('Cuerpo inválido', 400);
  }

  if (status !== 'visible' && status !== 'hidden') {
    return apiError('Estado inválido', 400);
  }

  await setPhotoStatus(id, status);
  return json({ ok: true, status });
};

export const DELETE: APIRoute = async ({ cookies, params }) => {
  const session = await requireAdmin(cookies);
  if (!session) return apiError('No autorizado', 401);

  const id = params.id;
  if (!id) return apiError('Foto inválida', 400);

  const photo = await ownedPhoto(id, session.eid);
  if (!photo) return apiError('Foto no encontrada', 404);

  const removed = await deletePhotoRow(id);
  if (removed) {
    await Promise.allSettled([
      deleteObjects([removed.display_key]),
      deleteThumbObjects([removed.thumb_key]),
    ]);
  }

  return json({ ok: true });
};
