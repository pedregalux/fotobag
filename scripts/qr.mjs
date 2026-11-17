#!/usr/bin/env node
/**
 * Genera un QR imprimible en SVG.
 *
 *   npm run qr -- https://fotos.nuestra-boda.com/e/mabel-y-belmar
 *
 * El SVG queda en qr.svg, listo para imprimir a 4-5 cm sin perder nitidez.
 * Probalo a 1,5 m con tres teléfonos distintos antes de mandarlo a imprimir.
 */
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const url = process.argv[2];
if (!url) {
  console.error('Uso: npm run qr -- <url del evento>');
  process.exit(1);
}

const svg = await QRCode.toString(url, {
  type: 'svg',
  errorCorrectionLevel: 'H',
  margin: 2,
  width: 1024,
  color: { dark: '#211d18', light: '#ffffff' },
});

writeFileSync('qr.svg', svg);
console.log(`qr.svg listo para ${url}`);
