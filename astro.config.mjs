import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';

export default defineConfig({
  // El adapter v14 ya no soporta Cloudflare Pages: deploya a Workers con static assets.
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [svelte()],
  output: 'server',
  // No usamos la Session API de Astro: evita aprovisionar un KV extra.
  session: false,
});
