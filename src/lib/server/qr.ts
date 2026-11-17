import { env } from 'cloudflare:workers';
import { renderSVG } from 'uqr';

/**
 * URL pública del evento.
 * En producción alcanza con el origin del request. Para probar desde un
 * teléfono en la red local, configurar PUBLIC_SITE_URL con la IP de la máquina.
 */
export function publicBase(requestOrigin: string): string {
  const configured = String(env.PUBLIC_SITE_URL ?? '')
    .trim()
    .replace(/\/$/, '');
  return configured || requestOrigin.replace(/\/$/, '');
}

export function eventUrl(origin: string, slug: string): string {
  return `${publicBase(origin)}/e/${slug}`;
}

export function qrSvg(value: string): string {
  return renderSVG(value, {
    ecc: 'H',
    border: 2,
    pixelSize: 12,
    blackColor: '#211d18',
    whiteColor: '#ffffff',
  });
}
