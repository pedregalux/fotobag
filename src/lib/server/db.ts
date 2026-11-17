import { env } from 'cloudflare:workers';

export type Visibility = 'open' | 'surprise' | 'closed';
export type PhotoStatus = 'visible' | 'hidden' | 'reported';

export type EventRow = {
  id: string;
  slug: string;
  title: string;
  couple_names: string | null;
  event_date: string | null;
  code_hash: string | null;
  visibility: Visibility;
  uploads_open: number;
  created_at: string;
};

export type PhotoRow = {
  id: string;
  event_id: string;
  display_key: string;
  thumb_key: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string;
  sha256: string;
  uploader_name: string | null;
  device_id: string | null;
  status: PhotoStatus;
  created_at: string;
};

export type PhotoInsert = {
  id: string;
  eventId: string;
  displayKey: string;
  thumbKey: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  deviceId: string;
  uploaderName: string | null;
};

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  return env.DB.prepare('SELECT * FROM events WHERE slug = ?').bind(slug).first<EventRow>();
}

export async function getEventById(id: string): Promise<EventRow | null> {
  return env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
}

export async function getPrimaryEvent(): Promise<EventRow | null> {
  return env.DB.prepare('SELECT * FROM events ORDER BY created_at ASC LIMIT 1').first<EventRow>();
}

export async function getPhotoById(id: string): Promise<PhotoRow | null> {
  return env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first<PhotoRow>();
}

export async function getPhotoByHash(eventId: string, sha256: string): Promise<PhotoRow | null> {
  return env.DB.prepare('SELECT * FROM photos WHERE event_id = ? AND sha256 = ?')
    .bind(eventId, sha256)
    .first<PhotoRow>();
}

export async function insertPhoto(photo: PhotoInsert): Promise<PhotoRow | null> {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO photos
      (id, event_id, display_key, thumb_key, width, height, bytes, sha256, device_id, uploader_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      photo.id,
      photo.eventId,
      photo.displayKey,
      photo.thumbKey,
      photo.width,
      photo.height,
      photo.bytes,
      photo.sha256,
      photo.deviceId,
      photo.uploaderName,
    )
    .run();

  if (result.meta.changes === 0) return null;
  return getPhotoById(photo.id);
}

export type PhotoPage = { items: PhotoRow[]; next: string | null };

export async function listPhotos(
  eventId: string,
  options: { cursor?: string | null; limit?: number; includeHidden?: boolean } = {},
): Promise<PhotoPage> {
  const limit = Math.min(Math.max(options.limit ?? 48, 1), 96);
  const where = ['event_id = ?'];
  const values: unknown[] = [eventId];

  if (!options.includeHidden) {
    where.push("status = 'visible'");
  }

  if (options.cursor) {
    const [createdAt, id] = options.cursor.split('|');
    if (createdAt && id) {
      where.push('(created_at < ? OR (created_at = ? AND id < ?))');
      values.push(createdAt, createdAt, id);
    }
  }

  values.push(limit + 1);

  const { results } = await env.DB.prepare(
    `SELECT * FROM photos WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(...values)
    .all<PhotoRow>();

  const items = results.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next: results.length > limit && last ? `${last.created_at}|${last.id}` : null,
  };
}

export async function countDevicePhotos(eventId: string, deviceId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM photos WHERE event_id = ? AND device_id = ?',
  )
    .bind(eventId, deviceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function setPhotoStatus(id: string, status: PhotoStatus): Promise<void> {
  await env.DB.prepare('UPDATE photos SET status = ? WHERE id = ?').bind(status, id).run();
}

export async function deletePhotoRow(id: string): Promise<PhotoRow | null> {
  const row = await getPhotoById(id);
  if (!row) return null;
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
  return row;
}

export async function setUploadsOpen(eventId: string, open: boolean): Promise<void> {
  await env.DB.prepare('UPDATE events SET uploads_open = ? WHERE id = ?')
    .bind(open ? 1 : 0, eventId)
    .run();
}

export async function setVisibility(eventId: string, visibility: Visibility): Promise<void> {
  await env.DB.prepare('UPDATE events SET visibility = ? WHERE id = ?')
    .bind(visibility, eventId)
    .run();
}

export type Stats = { total: number; visible: number; hidden: number; last24: number };

export async function getStats(eventId: string): Promise<Stats> {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'visible' THEN 1 ELSE 0 END), 0) AS visible,
       COALESCE(SUM(CASE WHEN status = 'hidden' THEN 1 ELSE 0 END), 0) AS hidden,
       COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS last24
     FROM photos WHERE event_id = ?`,
  )
    .bind(eventId)
    .first<Stats>();
  return row ?? { total: 0, visible: 0, hidden: 0, last24: 0 };
}

export async function recentAttempts(ip: string, windowSeconds = 60): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > unixepoch() - ?',
  )
    .bind(ip, windowSeconds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordAttempt(ip: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE ts < unixepoch() - 3600'),
    env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, unixepoch())').bind(ip),
  ]);
}

export async function clearAttempts(ip: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
