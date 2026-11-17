export function deviceId(): string {
  try {
    const key = 'fb_device';
    let value = localStorage.getItem(key);
    if (!value) {
      value = crypto.randomUUID();
      localStorage.setItem(key, value);
    }
    return value;
  } catch {
    return 'anonimo';
  }
}

export function uploaderName(): string {
  try {
    return localStorage.getItem('fb_name') ?? '';
  } catch {
    return '';
  }
}

export function setUploaderName(name: string): void {
  try {
    localStorage.setItem('fb_name', name.trim().slice(0, 40));
  } catch {
    // Safari en modo privado: no pasa nada.
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
