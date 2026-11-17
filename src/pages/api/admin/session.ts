import type { APIRoute } from 'astro';
import { adminCodeMatches, newSession, writeSession } from '@/lib/server/auth';
import {
  clearAttempts,
  getEventBySlug,
  getPrimaryEvent,
  recentAttempts,
  recordAttempt,
} from '@/lib/server/db';
import { apiError, clientIp, json } from '@/lib/server/http';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request, cookies }) => {
  let code = '';
  try {
    const body = (await request.json()) as { code?: unknown };
    code = String(body.code ?? '');
  } catch {
    return apiError('Cuerpo inválido', 400);
  }

  if (!code) return apiError('Falta la clave', 400);

  const ip = `admin:${clientIp(request)}`;
  if ((await recentAttempts(ip)) >= 5) {
    return apiError('Demasiados intentos. Espera un minuto.', 429);
  }

  if (!(await adminCodeMatches(code))) {
    await recordAttempt(ip);
    return apiError('Clave incorrecta', 401);
  }

  const event = env.PUBLIC_EVENT_SLUG
    ? await getEventBySlug(env.PUBLIC_EVENT_SLUG)
    : await getPrimaryEvent();

  if (!event) return apiError('No hay ningún evento configurado', 500);

  await clearAttempts(ip);
  await writeSession(cookies, newSession(event.id, 'admin'));
  return json({ ok: true, event: { slug: event.slug, title: event.title } });
};
