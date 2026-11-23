export type Compressed = {
  id: string;
  display: Blob;
  thumb: Blob;
  width: number;
  height: number;
  bytes: number;
};

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
// 2048 px es suficiente para pantalla completa y mantiene la foto liviana.
const DISPLAY_EDGE = 2048;
const THUMB_EDGE = 420;
const DISPLAY_QUALITY = 0.74;
const THUMB_QUALITY = 0.68;
// Si el navegador no puede codificar WebP, JPEG necesita un poco más de calidad.
const DISPLAY_JPEG_QUALITY = 0.8;
const THUMB_JPEG_QUALITY = 0.74;

type Decoded = ImageBitmap | HTMLImageElement;

function isHeic(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function decodeHtmlImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    image.src = url;
  });
}

async function decode(file: File): Promise<Decoded> {
  if (isHeic(file)) {
    // Safari suele convertir HEIC a JPEG solo, pero no siempre.
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
  }

  try {
    // imageOrientation aplica la rotación EXIF: sin esto las fotos salen acostadas.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return decodeHtmlImage(file);
  }
}

function dimensions(source: Decoded): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

async function encode(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    try {
      return await canvas.convertToBlob({ type, quality });
    } catch {
      // Algunos navegadores lanzan error si no soportan el formato.
      return null;
    }
  }

  return new Promise((resolve) => {
    (canvas as HTMLCanvasElement).toBlob(
      (result) => resolve(result),
      type,
      quality,
    );
  });
}

async function render(
  source: Decoded,
  edge: number,
  quality: number,
  jpegQuality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const original = dimensions(source);
  const scale = Math.min(1, edge / Math.max(original.width, original.height));
  const width = Math.max(1, Math.round(original.width * scale));
  const height = Math.max(1, Math.round(original.height * scale));

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) throw new Error('El navegador no pudo procesar la imagen');

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);

  // El re-encode borra el EXIF (incluido el GPS).
  // Primero WebP; si el navegador devuelve otro formato, caemos a JPEG.
  const webp = await encode(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') {
    return { blob: webp, width, height };
  }

  const jpeg = await encode(canvas, 'image/jpeg', jpegQuality);
  if (!jpeg) throw new Error('No se pudo comprimir la imagen');
  return { blob: jpeg, width, height };
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function compressImage(file: File): Promise<Compressed> {
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('La foto pesa más de 25 MB');
  }

  let source: Decoded | null = null;
  try {
    source = await decode(file);
    const [display, thumb] = await Promise.all([
      render(source, DISPLAY_EDGE, DISPLAY_QUALITY, DISPLAY_JPEG_QUALITY),
      render(source, THUMB_EDGE, THUMB_QUALITY, THUMB_JPEG_QUALITY),
    ]);

    return {
      id: await sha256(display.blob),
      display: display.blob,
      thumb: thumb.blob,
      width: display.width,
      height: display.height,
      bytes: display.blob.size,
    };
  } finally {
    if (source && 'close' in source) source.close();
  }
}
