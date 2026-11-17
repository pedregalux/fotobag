import type { APIRoute } from 'astro';
import {
  eventCodeMatches,
  newSession,
  readSession,
  writeSession,
} from '@/lib/server/auth';
import {
  clearAttempts,
  getEventBySlug,
  recentAttempts,
  recordAttempt,
} from '@/lib/server/db';
import { apiError, clientIp, json } from '@/lib/server/http';

export const POST: APIRoute = async ({ request, params, cookies }) => {
  const slug = params.slug;
  if (!slug) return apiError('Evento inválido', 400);

  const event = await getEventBySlug(slug);
  if (!event) return apiError('Evento no encontrado', 404);

  // Sin código configurado, el link del QR es la única llave.
  if (!event.code_hash) {
    await writeSession(cookies, newSession(event.id, 'guest'));
    return json({ ok: true });
  }

  let code = '';
  try {
    const body = (await request.json()) as { code?: unknown };
    code = String(body.code ?? '');
  } catch {
    return apiError('Cuerpo inválido', 400);
  }

  if (!/^\d{4,8}$/.test(code)) return apiError('Código inválido', 400);

  const ip = clientIp(request);
  if ((await recentAttempts(ip)) >= 5) {
    return apiError('Demasiados intentos. Espera un minuto.', 429);
  }

  if (!(await eventCodeMatches(event, code))) {
    await recordAttempt(ip);
    return apiError('Código incorrecto', 401);
  }

  await clearAttempts(ip);
  await writeSession(cookies, newSession(event.id, 'guest'));
  return json({ ok: true });
};

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  return json({ authenticated: Boolean(session) });
};
