# Fotobag

Álbum colectivo para una boda. Los invitados escanean un QR, suben sus fotos desde el navegador (sin app ni cuenta) y todo queda en un álbum privado para los novios.

**Stack:** Astro 7 (SSR) + Cloudflare Workers + R2 + D1. Repo en GitHub, deploy en Cloudflare.

---

## Estado

Scaffold funcional. Incluye:

- Landing del evento, con acceso directo por el link del QR.
- Subida múltiple con compresión en el navegador (2560 px + miniatura 480 px).
- HEIC de iPhone con fallback (`heic2any`).
- Cola persistente en IndexedDB con reintentos y reanudación.
- Galería paginada con visor y descarga individual.
- Panel de administración: métricas, ocultar/mostrar, eliminar, cerrar subidas, modo sorpresa.
- Sesión con cookie HMAC, headers de seguridad, rate limit básico.
- PWA mínima (manifest + service worker) y QR imprimible.

No incluye (a propósito): video, edición, multi-evento, muro en vivo. Ver `PLAN.md` para el alcance completo.

---

## Requisitos

- Node.js >= 22.23
- Una cuenta de Cloudflare (para deploy; en local no hace falta)
- ImageMagick solo si quieres regenerar los íconos

---

## Puesta en marcha local

```bash
npm install
cp .dev.vars.example .dev.vars     # ya viene creado en este repo
npm run db:migrate                 # crea las tablas en D1 local
npm run db:seed                    # evento de ejemplo
npm run dev
```

Abre la URL que imprime el servidor (por defecto `http://localhost:4321`, o el siguiente puerto libre).

> Astro 7 corre el servidor en segundo plano. Se maneja con `npx astro dev status`, `npx astro dev logs` y `npx astro dev stop`.

- Evento: `/e/mabel-y-belmar`
- Panel: `/admin` → clave **1234**
- QR imprimible: `/admin/qr` (con sesión de admin)

El QR **no aparece en la página del invitado**: es el objeto impreso que apunta a ella. Se genera en `/admin/qr`, se imprime y se coloca en las mesas. El invitado lo escanea y entra directo al evento: no hay código de invitado.

El acceso es solo por el link. Si quieres que no sea adivinable, cambia el slug por uno con sufijo aleatorio (`mabel-y-belmar-7f3k`); el QR se regenera solo. El panel sí sigue protegido con la clave de `ADMIN_CODE`.

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con workerd, D1 y R2 locales |
| `npm run build` | Build de producción |
| `npm run preview` | Preview del build con el runtime real de Workers |
| `npm run check` | `wrangler types` + `astro check` |
| `npm run deploy` | Build + `wrangler deploy` |
| `npm run db:migrate` | Migraciones D1 locales |
| `npm run db:seed` | Evento de ejemplo local |
| `npm run qr -- <url>` | Genera `qr.svg` imprimible |

---

## Cómo funciona

```
QR → /e/[slug] → cookie firmada automática
   → elegir fotos → comprimir en el teléfono → cola en IndexedDB
   → POST /api/e/[slug]/photos (FormData: display + thumb)
   → Worker valida, escribe en R2 y guarda metadata en D1
   → galería SSR + miniaturas desde el dominio público de R2
```

### Compresión (la parte crítica)

`src/lib/client/compress.ts`:

1. `createImageBitmap(file, { imageOrientation: 'from-image' })` para respetar la rotación EXIF.
2. Canvas a 2560 px (display, JPEG q0.82) y 480 px (miniatura, q0.75).
3. El re-encode borra el EXIF, incluido el GPS.
4. SHA-256 del display para deduplicar (también sirve de idempotencia en D1).
5. HEIC: `heic2any` solo si el archivo es HEIC y el navegador no lo pudo decodificar.

Con esto, 120 invitados × ~70 fotos quedan en ~4 GB en vez de ~13 GB.

### Cola

`src/lib/client/queue.ts` guarda los blobs comprimidos en IndexedDB. Si se corta la señal o se cierra la pestaña, al volver se retoman las pendientes. Reintentos con backoff exponencial (máximo 5) y reintento inmediato al recuperar conexión o volver a la pestaña.

### Almacenamiento

| Bucket | Contenido | Acceso |
|---|---|---|
| `fotobag-originals` | JPEG 2560 px | Privado, servido por `/api/e/[slug]/file/[id]` con cookie |
| `fotobag-thumbs` | JPEG 480 px | Dominio propio en R2, cacheado en el edge |

Si `PUBLIC_THUMBS_BASE` está vacío, las miniaturas se sirven por `/api/thumb/[id]` (útil en local). En producción se configura el dominio del bucket para no gastar invocaciones.

### Base de datos

`migrations/`: esquema inicial (`0001`) y eliminación del código de invitado (`0002`).

`photos` tiene `UNIQUE (event_id, sha256)`, así que un reintento no duplica nada.

---

## API

| Método | Ruta | Descripción |
|---|---|---|
| `GET/POST` | `/api/e/[slug]/photos` | Listar (paginado) / subir |
| `GET` | `/api/e/[slug]/file/[id]` | Original autenticado |
| `GET` | `/api/thumb/[id]` | Miniatura (fallback) |
| `POST` | `/api/admin/session` | Clave → cookie de admin |
| `GET` | `/api/admin/photos` | Listado completo (incluye ocultas) |
| `PATCH/DELETE` | `/api/admin/photos/[id]` | Ocultar/mostrar/eliminar |
| `PATCH` | `/api/admin/event` | Abrir/cerrar subidas, visibilidad |
| `GET` | `/api/admin/qr.svg` | Descarga del QR |

---

## Deploy a Cloudflare

```bash
npx wrangler login

npx wrangler r2 bucket create fotobag-originals
npx wrangler r2 bucket create fotobag-thumbs
npx wrangler d1 create fotobag
# Pegar el database_id que devuelve el comando en wrangler.jsonc

npx wrangler types
npx wrangler secret put SESSION_SECRET     # cadena larga y aleatoria
npx wrangler secret put ADMIN_CODE         # clave del panel

npm run db:migrate:remote
npm run db:seed:remote
npm run deploy
```

Después:

1. En R2 → `fotobag-thumbs` → Settings → Public access → Custom domain: `thumbs.tu-dominio.com`.
2. Pon ese dominio en `vars.PUBLIC_THUMBS_BASE` de `wrangler.jsonc` y vuelve a deployar.
3. Apunta el dominio principal al Worker (Custom Domain en la configuración del Worker).

### URL del QR

`/admin/qr` usa el dominio desde el que se abre la página, así que en producción no hace falta configurar nada. Para probar desde un teléfono en la red local:

```bash
# en wrangler.jsonc: "PUBLIC_SITE_URL": "http://192.168.1.50:4321"
npx astro dev --host 0.0.0.0
```

Así el QR apunta a la IP de tu máquina y el teléfono puede abrirlo. En producción se puede dejar `PUBLIC_SITE_URL` vacío o fijarlo al dominio definitivo.

### Deploy automático desde GitHub

Opción A, **Workers Builds**: en el dashboard, Workers & Pages → Create → Connect to Git. Build `npm run build`, deploy `npx wrangler deploy`.

Opción B, **GitHub Actions**: agregar `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` como secretos y un workflow con `cloudflare/wrangler-action`.

El workflow incluido (`.github/workflows/ci.yml`) solo valida: `npm ci`, `npm run check`, `npm run build`.

---

## Operación el día del evento

- Antes: probar en 2-3 teléfonos reales, con WiFi y 4G. Probar HEIC, 50 fotos seguidas y cerrar/reabrir la pestaña.
- QR: desde `/admin/qr` (imprimir o descargar SVG) o con `npm run qr -- https://fotos.tu-dominio.com/e/mabel-y-belmar`. Imprimir a 4-5 cm, alto contraste, corrección H. Probar a 1,5 m.
- Durante: panel abierto en un teléfono. El botón "Cerrar subidas" corta todo al final.
- Modo sorpresa: panel → Galería → "Sorpresa". Los invitados ven un aviso; los novios ven todo.
- Después: `scripts/export.sh` descarga D1 + ambos buckets, compara conteos y avisa si no coinciden. **Guardar dos copias.**

---

## Seguridad y privacidad

- Cookie `HttpOnly`, `Secure` en producción, HMAC-SHA256, 24 h.
- Originales en bucket privado; `Cache-Control: private, immutable`.
- Miniaturas públicas por diseño (480 px, URL UUID, sin indexación). Si prefieres privacidad total: bucket privado + ruta autenticada + Workers paid.
- EXIF/GPS eliminados en el cliente.
- Rate limit de 5 intentos por minuto para la clave de admin; tope de 300 fotos por dispositivo.
- El slug es la única llave del álbum: si el evento es privado, usa un slug no adivinable.
- Headers: CSP, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
- `robots.txt` bloquea todo; páginas con `noindex`.

---

## Decisiones del scaffold

- **Astro 7 usa expresiones JSX** (`{cond ? (...) : (...)}`, `.map()`) en lugar de `{#if}` / `{#each}`. Las plantillas `.astro` de este repo siguen esa sintaxis.
- **Se deploya a Workers, no a Pages**: el adapter de Cloudflare dejó de soportar Pages en v13.
- **Acceso a bindings** con `import { env } from 'cloudflare:workers'` (ya no existe `Astro.locals.runtime`).
- **CSS propio** en vez de Tailwind: menos dependencias y bundle más chico para una app de 4 pantallas.
- `worker-configuration.d.ts` es generado por `wrangler types` y está en `.gitignore`.

---

## Pendientes

- [ ] Tests E2E con Playwright (subida real con `setInputFiles`).
- [ ] Load test de subidas concurrentes.
- [ ] Muro en vivo (SSE + slideshow).
- [ ] Descarga ZIP en streaming.
- [ ] Video corto.
- [ ] Multi-evento.
