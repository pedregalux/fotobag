import type { APIRoute } from 'astro';
import { requireAdmin } from '@/lib/server/auth';
import { listPhotos, type PhotoRow } from '@/lib/server/db';
import { apiError, json } from '@/lib/server/http';
import { thumbUrl } from '@/lib/server/r2';

export const GET: APIRoute = async ({ request, cookies }) => {
  const session = await requireAdmin(cookies);
  if (!session) return apiError('No autorizado', 401);

  const url = new URL(request.url);
  const page = await listPhotos(session.eid, {
    cursor: url.searchParams.get('cursor'),
    includeHidden: true,
  });

  return json({
    items: page.items.map((row: PhotoRow) => ({
      id: row.id,
      thumbUrl: thumbUrl(row.id, row.thumb_key),
      width: row.width ?? 1,
      height: row.height ?? 1,
      name: row.uploader_name,
      createdAt: row.created_at,
      status: row.status,
    })),
    next: page.next,
  });
};
