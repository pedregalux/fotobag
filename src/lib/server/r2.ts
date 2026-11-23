import { env } from 'cloudflare:workers';

function extension(contentType: string): 'webp' | 'jpg' {
  return contentType === 'image/webp' ? 'webp' : 'jpg';
}

export function objectKeys(
  eventId: string,
  photoId: string,
  displayType = 'image/jpeg',
  thumbType = 'image/jpeg',
) {
  const base = `e/${eventId}/${photoId}`;
  return {
    display: `${base}/d.${extension(displayType)}`,
    thumb: `${base}/t.${extension(thumbType)}`,
  };
}

export async function putPhotoObjects(
  keys: { display: string; thumb: string },
  display: Blob,
  thumb: Blob,
): Promise<void> {
  await Promise.all([
    env.ORIGINALS.put(keys.display, display.stream(), {
      httpMetadata: { contentType: display.type || 'image/jpeg' },
    }),
    env.THUMBS.put(keys.thumb, thumb.stream(), {
      httpMetadata: {
        contentType: thumb.type || 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    }),
  ]);
}

export async function deleteObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => env.ORIGINALS.delete(key)));
}

export async function deleteThumbObjects(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => env.THUMBS.delete(key)));
}

/**
 * En producción las miniaturas se sirven desde un dominio propio apuntando al
 * bucket público (cacheado en el edge, sin consumir invocaciones). Si no está
 * configurado, se usa la ruta /api/thumb/[id] como fallback.
 */
export function thumbUrl(photoId: string, thumbKey: string): string {
  const base = String(env.PUBLIC_THUMBS_BASE ?? '')
    .trim()
    .replace(/\/$/, '');
  if (base) return `${base}/${thumbKey}`;
  return `/api/thumb/${photoId}`;
}
