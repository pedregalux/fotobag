import { env } from 'cloudflare:workers';

const encoder = new TextEncoder();

export type Role = 'guest' | 'admin';
export type Session = { eid: string; role: Role; exp: number };

export const SESSION_COOKIE = 'fb_session';
export const SESSION_MAX_AGE = 60 * 60 * 24; // 24 h

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function newSession(eventId: string, role: Role): Session {
  return { eid: eventId, role, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
}

export async function signSession(session: Session): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env.SESSION_SECRET),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyToken(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(env.SESSION_SECRET),
      fromBase64Url(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;

    const session = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as Session;
    if (session.exp < Math.floor(Date.now() / 1000)) return null;
    if (session.role !== 'guest' && session.role !== 'admin') return null;
    return session;
  } catch {
    return null;
  }
}

type CookieReader = { get(name: string): { value: string } | undefined };
type CookieWriter = {
  set(
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      secure: boolean;
      sameSite: 'lax';
      path: string;
      maxAge: number;
    },
  ): void;
  delete(name: string, options: { path: string }): void;
};

export function cookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  };
}

export async function readSession(cookies: CookieReader): Promise<Session | null> {
  return verifyToken(cookies.get(SESSION_COOKIE)?.value);
}

export async function requireAdmin(cookies: CookieReader): Promise<Session | null> {
  const session = await readSession(cookies);
  return session?.role === 'admin' ? session : null;
}

export async function writeSession(cookies: CookieWriter, session: Session): Promise<Session> {
  cookies.set(SESSION_COOKIE, await signSession(session), cookieOptions());
  return session;
}

/**
 * El link del QR es la única llave del evento: si no hay sesión (o es de otro
 * evento), se emite una de invitado automáticamente.
 */
export async function ensureGuestSession(
  cookies: CookieReader & CookieWriter,
  eventId: string,
): Promise<Session> {
  const session = await readSession(cookies);
  if (session && session.eid === eventId) return session;
  return writeSession(cookies, newSession(eventId, 'guest'));
}

export function clearSession(cookies: CookieWriter): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function adminCodeMatches(code: string): Promise<boolean> {
  const [candidate, expected] = await Promise.all([
    sha256Hex(`admin:${code.trim()}`),
    sha256Hex(`admin:${env.ADMIN_CODE}`),
  ]);
  return timingSafeEqual(candidate, expected);
}
