import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';

const HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-robots-tag': 'noindex, nofollow',
};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  for (const [name, value] of Object.entries(HEADERS)) {
    response.headers.set(name, value);
  }

  if (import.meta.env.PROD) {
    let thumbs = '';
    try {
      const base = String(env.PUBLIC_THUMBS_BASE ?? '').trim();
      if (base) thumbs = new URL(base).origin;
    } catch {
      thumbs = '';
    }

    const imgSrc = ["'self'", 'data:', 'blob:', thumbs].filter(Boolean).join(' ');
    response.headers.set(
      'content-security-policy',
      [
        "default-src 'self'",
        `img-src ${imgSrc}`,
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; '),
    );
  }

  return response;
});
