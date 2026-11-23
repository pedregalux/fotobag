import type { APIRoute } from 'astro';
import { readSession } from '@/lib/server/auth';
import {
  countDevicePhotos,
  getEventBySlug,
  getPhotoByHash,
  insertPhoto,
  listPhotos,
  type PhotoRow,
} from '@/lib/server/db';
import { apiError, json } from '@/lib/server/http';
import { deleteObjects, deleteThumbObjects, objectKeys, putPhotoObjects, thumbUrl } from '@/lib/server/r2';

const MAX_DISPLAY_BYTES = 8_000_000;
const MAX_THUMB_BYTES = 300_000;
const MAX_PHOTOS_PER_DEVICE = 300;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/webp']);

type PhotoItem = {
  id: string;
  thumbUrl: string;
  width: number;
  height: number;
  name: string | null;
  createdAt: string;
  mime: string;
  status?: string;
};

function toItem(row: PhotoRow): PhotoItem {
  return {
    id: row.id,
    thumbUrl: thumbUrl(row.id, row.thumb_key),
    width: row.width ?? 1,
    height: row.height ?? 1,
    name: row.uploader_name,
    createdAt: row.created_at,
    mime: row.mime,
    status: row.status,
  };
}

export const GET: APIRoute = async ({ request, params, cookies }) => {
  const slug = params.slug;
  if (!slug) return apiError('Evento inválido', 400);

  const session = await readSession(cookies);
  if (!session) return apiError('Sesión no encontrada. Abre el link del evento.', 401);

  const event = await getEventBySlug(slug);
  if (!event || event.id !== session.eid) return apiError('Evento no encontrado', 404);

  const isAdmin = session.role === 'admin';
  if (event.visibility === 'surprise' && !isAdmin) {
    return json({ items: [], next: null, locked: true });
  }

  const url = new URL(request.url);
  const page = await listPhotos(event.id, {
    cursor: url.searchParams.get('cursor'),
    includeHidden: isAdmin,
  });

  return json({ items: page.items.map(toItem), next: page.next });
};

export const POST: APIRoute = async ({ request, params, cookies }) => {
  const slug = params.slug;
  if (!slug) return apiError('Evento inválido', 400);

  const session = await readSession(cookies);
  if (!session) return apiError('Sesión vencida. Vuelve a entrar.', 401);

  const event = await getEventBySlug(slug);
  if (!event || event.id !== session.eid) return apiError('Evento no encontrado', 404);
  if (!event.uploads_open) return apiError('Las subidas están cerradas', 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError('No se pudo leer el formulario', 400);
  }

  const display = form.get('display');
  const thumb = form.get('thumb');
  if (!(display instanceof File) || !(thumb instanceof File)) {
    return apiError('Faltan los archivos', 400);
  }
  if (display.size > MAX_DISPLAY_BYTES) return apiError('La foto es demasiado grande', 413);
  if (thumb.size > MAX_THUMB_BYTES) return apiError('Miniatura inválida', 413);
  if (!ALLOWED_TYPES.has(display.type)) return apiError('Formato no soportado', 415);
  if (!ALLOWED_TYPES.has(thumb.type)) return apiError('Miniatura inválida', 415);

  const sha256 = String(form.get('sha256') ?? '');
  if (!/^[a-f0-9]{64}$/.test(sha256)) return apiError('Hash inválido', 400);

  const deviceId = String(form.get('deviceId') ?? '').slice(0, 80);
  if (deviceId.length < 8) return apiError('Dispositivo inválido', 400);

  const uploaderName = String(form.get('name') ?? '').trim().slice(0, 40) || null;
  const width = Number.parseInt(String(form.get('width') ?? '0'), 10) || 0;
  const height = Number.parseInt(String(form.get('height') ?? '0'), 10) || 0;

  // Reintento de una foto que ya llegó: no duplicar ni gastar cupo.
  const existing = await getPhotoByHash(event.id, sha256);
  if (existing) {
    return json({ duplicate: true, item: toItem(existing) });
  }

  if ((await countDevicePhotos(event.id, deviceId)) >= MAX_PHOTOS_PER_DEVICE) {
    return apiError('Este dispositivo alcanzó el límite de fotos', 429);
  }

  const id = crypto.randomUUID();
  const keys = objectKeys(event.id, id, display.type, thumb.type);

  await putPhotoObjects(keys, display, thumb);

  const row = await insertPhoto({
    id,
    eventId: event.id,
    displayKey: keys.display,
    thumbKey: keys.thumb,
    width,
    height,
    bytes: display.size,
    mime: display.type,
    sha256,
    deviceId,
    uploaderName,
  });

  if (!row) {
    // Otra pestaña subió la misma foto entre el chequeo y el insert.
    await deleteObjects([keys.display]);
    await deleteThumbObjects([keys.thumb]);
    const duplicate = await getPhotoByHash(event.id, sha256);
    if (duplicate) return json({ duplicate: true, item: toItem(duplicate) });
    return apiError('No se pudo guardar la foto', 500);
  }

  return json({ item: toItem(row) }, 201);
};
