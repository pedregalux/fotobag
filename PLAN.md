# Fotobag — Plan de proyecto

> Álbum colectivo para una boda: los invitados escanean un QR, suben sus fotos desde el navegador (sin app ni cuenta) y todo queda en un álbum privado que los novios se llevan al final.
>
> **Stack:** Astro 7 + Cloudflare Workers + R2 + D1. GitHub como repositorio y CI.
>
> **Estado:** el esqueleto ya está implementado en este repo (ver `README.md`).

---

## 0. Resumen ejecutivo

La idea es más pequeña de lo que parece: **no hay que construir un servicio de alojamiento, solo una interfaz de subida y una galería**. El hospedaje gratuito es la parte fácil; lo que decide si funciona es:

1. **Comprimir en el teléfono antes de subir.** Sin esto, 120 invitados generan ~13 GB, no entra en ningún free tier y las subidas fallan con mala señal.
2. **Evitar que las fotos pasen por funciones con límites chicos.** En Workers el límite es 100 MB por request, así que una subida de ~1 MB no tiene problema; aun así conviene comprimir.
3. **Tener un plan B para el día del evento**, porque el WiFi del salón siempre es peor de lo que dicen.

Arquitectura: **Astro SSR en Cloudflare Workers**, fotos en **R2** (10 GB gratis, egress $0), metadata en **D1**, deploy automático desde **GitHub**. Costo total: el dominio.

**Aclaración clave:** GitHub guarda el código, no las fotos. Un repo con 5.400 imágenes queda inflado para siempre y no hay forma de que un invitado suba sin exponer un token.

---

## 1. El problema real (más allá del QR)

| Necesidad | Por qué importa |
|---|---|
| Subir 50 fotos de una vez sin que se cuelgue | La gente no sube de a una |
| Funcionar con WiFi malo o 4G saturado | Un salón con 120 personas satura la red |
| Aceptar HEIC de iPhone | Si falla, se pierde la mitad de los invitados |
| Confirmar que la foto llegó | Sin confirmación, la gente reintenta o se rinde |
| Que las fotos no se pierdan | Es el recuerdo de una noche irrecuperable |
| Privacidad | Son fotos de personas, con GPS en el EXIF |
| Galería rápida y agradable | Es lo que ven los invitados y lo que queda |
| Descarga masiva al final | El objetivo real: que los novios tengan todo |

**Métricas de éxito:** porcentaje de invitados que suben al menos una foto, fotos por invitado, tasa de error de subida, tiempo hasta la primera subida. Si el 60% sube dos o más fotos, es un éxito.

---

## 2. Alcance

### MVP
- Página de evento con URL corta y QR.
- Subida múltiple desde cámara o galería, con compresión en el navegador.
- Cola con reintentos, persistida, y estado visible ("12 ✓ / 2 pendientes").
- Galería paginada con miniaturas y visor.
- Acceso con código de evento (no indexable).
- Panel de los novios: ver todo, ocultar/eliminar, descargar.

### v1
- PWA "agregar a inicio" y reanudación de subidas.
- Muro en vivo para una TV durante la fiesta (esto **dispara** la participación).
- Nombre o apodo de quien sube.
- Reacciones o "foto destacada".
- Script de exportación (rclone + verificación) y backups.

### Futuro / producto
- Multi-evento y autoservicio.
- Álbum impreso, video corto, slideshow posterior.
- Moderación asistida y marca blanca para wedding planners.

### Fuera de alcance (conviene dejarlo claro)
- Edición, filtros, IA.
- App nativa.
- Chat o red social.
- Video largo: en el MVP, solo fotos (o clips menores a 30 s).

---

## 3. Flujos

### Invitado
```
QR en la mesa → fotos.nuestra-boda.com/e/ana-y-luis
  → "¡Gracias por venir! Sube las fotos que hagas"
  → [Tomar foto]  [Elegir de mi galería]
  → selecciona N fotos
  → compresión en el teléfono (progreso)
  → subida de a 3, con confirmación por foto
  → "Listo, 14 fotos. ¿Ver las de los demás?" → galería
```

Detalles que definen el resultado:
- **Dos botones grandes**, no un input genérico: los invitados mayores no entienden un `<input type="file">`.
- **Nada de login.** Un código de 4-6 dígitos como máximo.
- **Confirmación inequívoca.** Un check por foto y un contador; si algo queda pendiente, avisar que se reintenta solo.
- **Tolerancia a la interrupción.** Si cierran la pestaña, la cola sigue en IndexedDB y se retoma.

### Pareja / admin
```
clave → panel
  → contador de fotos, últimas 24 h, ocultas
  → galería completa + ocultar/eliminar
  → "cerrar subidas" al terminar
  → exportar todo → 2 backups
```

---

## 4. Arquitectura

```
        ┌──────────────┐  push   ┌──────────────────────────────┐
        │   GitHub     │────────►│  Cloudflare Workers          │
        │  repo + CI   │  build  │  Astro SSR (workerd)         │
        └──────────────┘         │  /e/[slug]  /galeria  /admin │
                                 └───────┬──────────────┬───────┘
                                         │              │
                          R2 binding     │              │  D1 binding
                                         ▼              ▼
                                 ┌──────────────┐  ┌──────────────┐
                                 │ R2           │  │ D1 (SQLite)  │
                                 │ originals 🔒 │  │ eventos,fotos│
                                 │ thumbs 🌐    │  │ reportes     │
                                 └──────────────┘  └──────────────┘

  thumbs: dominio propio en R2, cacheado en el edge, sin pasar por el Worker
  originals: bucket privado, se sirven por /api/.../file/[id] con cookie firmada
```

### Decisiones de diseño

**Todo en Cloudflare.** Un proveedor, un deploy, sin cold starts facturables. El repo se conecta a Workers Builds (o se despliega con `wrangler deploy` desde GitHub Actions) y cada push publica. Los preview deployments se pueden agregar después.

**Subida a través del Worker.** El invitado envía un `FormData` con la foto comprimida y la miniatura; la función valida, guarda en R2 por streaming (`file.stream()` → `BUCKET.put()`) e inserta la fila en D1, todo en un request. Es más simple que firmar URLs (sin credenciales S3, sin CORS, funciona igual en local) y el límite de 100 MB por request sobra para archivos de ~1 MB. Si algún día hay que escalar, se puede pasar a presigned PUT sin cambiar el cliente.

**Miniaturas públicas, originales privados.** Las miniaturas (480 px, ~30 KB) se sirven desde un dominio propio apuntando a un bucket público: las cachea el edge, no consumen invocaciones y no tienen techo de tráfico. Los originales quedan en un bucket privado detrás de una ruta autenticada. El riesgo residual es que una miniatura de 480 px con URL UUID se filtre; es un intercambio razonable y explícito. Si se prefiere privacidad total: miniaturas privadas + plan Workers de US$ 5 el mes del evento, y solo cambia la URL base.

**D1 en vez de Postgres.** Son ~5.000 filas y consultas triviales. D1 es gratis, vive en el mismo deploy y se exporta con un comando. Si el proyecto crece a SaaS, migrar a Postgres es una tarde.

**Por qué no GitHub Pages:** solo estático, sin funciones, sin secretos, 1 GB de sitio. No puede firmar sesiones ni escribir en R2.

**Por qué no Cloudflare Pages:** el adapter de Astro dejó de soportar Pages en la versión 13. El destino actual es Workers con static assets, que además tiene mejor integración con `astro dev` y `astro preview`.

### ¿Qué puede y qué no puede hacer GitHub?

| Uso | Veredicto |
|---|---|
| Repo, PRs, revisión | ✅ |
| Actions: `astro check`, build, Playwright | ✅ |
| Disparar el deploy en Workers Builds | ✅ |
| Guardar fotos (repo o LFS) | ❌ 100 MB/archivo, 5 GB repo, LFS 1 GB |
| Servir imágenes (`raw`, Camo) | ❌ no es CDN, sin control de acceso |
| GitHub Pages como host | ❌ sin SSR/API, 1 GB |
| Backup del dump de D1 | ✅ (SQL pequeño) |

---

## 5. Stack concreto

| Capa | Elección | Por qué |
|---|---|---|
| Front | Astro 7 + CSS propio | HTML estático por defecto; islas solo donde hace falta JS |
| Isla interactiva | Svelte 5 | El uploader tiene estado real (cola, progreso, reintentos); ~15 KB |
| Host | Cloudflare Workers + static assets | Free tier, deploy desde GitHub, runtime real en local |
| Fotos | Cloudflare R2 (2 buckets) | 10 GB, egress $0, S3-compatible |
| DB | Cloudflare D1 | SQLite en el edge, 5 GB |
| Imágenes | Canvas + `heic2any` en el cliente | Sin pipeline de servidor |
| PWA | Manifest + service worker propio | Instalable, cachea solo el shell |
| QR | `qrcode` → SVG 300 dpi | Imprimible, escaneable a 1,5 m |

### Límites del free tier (y si alcanzan)

| Recurso | Free | Consumo estimado | ¿Alcanza? |
|---|---|---|---|
| Workers (invocaciones) | 100k/día, 10 ms CPU | ~15k/día (subidas + originales) | ✅ |
| Static assets | No invocan al Worker | HTML, CSS, JS | ✅ |
| R2 storage | 10 GB | ~4 GB | ✅ |
| R2 Class A (escrituras) | 1M/mes | ~11k | ✅ |
| R2 egress | **$0** | ~50 GB | ✅ |
| D1 storage | 5 GB | <50 MB | ✅ |
| D1 escrituras | 100k filas/día | ~6k | ✅ |
| Workers Builds | 3.000 min/mes | ~50 | ✅ |
| Actions | 2.000 min/mes (privado) | ~100 | ✅ |

El bundle del Worker medido en el scaffold: **584 KiB sin comprimir, 157 KiB gzip**, muy lejos del límite de 3 MB del plan gratis.

El único número ajustado es el de invocaciones, y por eso las miniaturas van por el dominio de R2 y no por el Worker.

### Estructura del repo

```
fotobag/
├── astro.config.mjs
├── wrangler.jsonc
├── migrations/0001_init.sql
├── scripts/export.sh
├── scripts/qr.mjs
├── scripts/seed.sql
├── src/
│   ├── pages/
│   │   ├── index.astro                  # redirección al evento
│   │   ├── e/[slug]/index.astro         # landing + <Uploader />
│   │   ├── e/[slug]/galeria.astro       # SSR + <Gallery />
│   │   ├── admin/index.astro
│   │   └── api/...
│   ├── components/
│   │   ├── Uploader.svelte
│   │   ├── Gallery.svelte
│   │   ├── AdminPanel.svelte
│   │   └── CodeGate.astro
│   ├── lib/
│   │   ├── server/{auth,db,r2,http}.ts
│   │   └── client/{compress,queue,device,types}.ts
│   ├── layouts/Base.astro
│   ├── middleware.ts
│   └── styles/global.css
├── public/...
└── .github/workflows/ci.yml
```

### Configuración base

`astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';

export default defineConfig({
  adapter: cloudflare({ imageService: 'passthrough' }),
  integrations: [svelte()],
  output: 'server',
  session: false,
});
```

`wrangler.jsonc` (resumen):

```jsonc
{
  "name": "fotobag",
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_date": "2026-11-01",
  "assets": { "directory": "./dist", "binding": "ASSETS" },
  "r2_buckets": [
    { "binding": "ORIGINALS", "bucket_name": "fotobag-originals" },
    { "binding": "THUMBS", "bucket_name": "fotobag-thumbs" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "fotobag", "database_id": "..." }
  ],
  "vars": {
    "PUBLIC_THUMBS_BASE": "",
    "PUBLIC_EVENT_SLUG": "ana-y-luis"
  }
}
```

Acceso a bindings (ya no existe `Astro.locals.runtime`):

```ts
import { env } from 'cloudflare:workers';

await env.DB.prepare('SELECT ...').bind(id).first();
await env.ORIGINALS.put(key, file.stream());
```

Secretos locales en `.dev.vars` (`SESSION_SECRET`, `ADMIN_CODE`); en producción con `wrangler secret put`.

```bash
npx wrangler types
npm run dev          # astro dev con workerd, R2 y D1 locales
npm run db:migrate
npm run db:seed
```

### Deploy y CI

- **Deploy:** Workers Builds conectado al repo, o `npm run deploy` (`astro build && wrangler deploy`).
- **CI (`.github/workflows/ci.yml`):** `npm ci` → `npm run check` → `npm run build`.
- **Migraciones:** manuales con `wrangler d1 migrations apply`, documentadas en el README.

---

## 6. El corazón: compresión en el navegador

Sin esto no hay proyecto. Con 120 invitados:

| Escenario | Cálculo | Total |
|---|---|---|
| Originales de teléfono | 5.460 × 2,5 MB | **~13,6 GB** ❌ |
| Display 2560 px + miniatura | 5.460 × 700 KB + 5.460 × 30 KB | **~4,0 GB** ✅ |
| Display 2048 px + miniatura | 5.460 × 450 KB + miniaturas | **~2,7 GB** ✅ |

(120 invitados × 65% que suben × 70 fotos ≈ 5.460 fotos)

A 2560 px se ve perfecto en pantalla y se imprime 10×15 sin problema. Si los novios quieren originales, es un extra de pago o un disco físico, no un free tier.

### Pipeline

1. `createImageBitmap(file, { imageOrientation: 'from-image' })` para aplicar la rotación EXIF. Sin esto, las fotos de iPhone salen acostadas.
2. Dibujar en canvas al lado mayor 2560 px (display) y 480 px (miniatura).
3. Exportar JPEG q0.82 y q0.75.
4. El re-encode **borra el EXIF**, incluido el GPS. Privacidad gratis.
5. HEIC: Safari suele convertir a JPEG al subir, pero no siempre → `heic2any` como fallback, cargado solo si el archivo es HEIC.
6. SHA-256 del blob comprimido → deduplicación (la clave única en D1 lo garantiza).
7. Cola en IndexedDB: estado por foto, reintentos con backoff, reanudación en `online` y `visibilitychange`.

```ts
const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
const canvas = new OffscreenCanvas(
  Math.round(bitmap.width * scale),
  Math.round(bitmap.height * scale),
);
canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
const display = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
```

Reglas de recursos:
- **Concurrencia de compresión 2**, no 8: en un teléfono viejo, ocho canvas de 12 MP matan la pestaña.
- Subida de a 3 en paralelo.
- Tope de 300 fotos por dispositivo, 25 MB de entrada, 8 MB de salida.
- Botón de reintento visible y estado por archivo.
- La UI nunca se bloquea: todo ocurre en una isla, no en el hilo de render del documento.

---

## 7. Datos y API

```sql
CREATE TABLE events (
  id            TEXT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  couple_names  TEXT,
  event_date    TEXT,
  code_hash     TEXT,                            -- sha256("<slug>:<codigo>")
  visibility    TEXT NOT NULL DEFAULT 'open',    -- open | surprise | closed
  uploads_open  INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id),
  display_key   TEXT NOT NULL,
  thumb_key     TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  bytes         INTEGER,
  mime          TEXT NOT NULL DEFAULT 'image/jpeg',
  sha256        TEXT NOT NULL,
  uploader_name TEXT,
  device_id     TEXT,
  status        TEXT NOT NULL DEFAULT 'visible', -- visible | hidden | reported
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, sha256)
);

CREATE INDEX idx_photos_feed ON photos(event_id, status, created_at DESC, id DESC);

CREATE TABLE reports (
  id         TEXT PRIMARY KEY,
  photo_id   TEXT NOT NULL REFERENCES photos(id),
  reason     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE login_attempts (ip TEXT NOT NULL, ts INTEGER NOT NULL);
```

`UNIQUE(event_id, sha256)` + `INSERT OR IGNORE` = reintentos idempotentes sin código extra.

### Endpoints

```
POST   /api/e/:slug/session       { code } → cookie HttpOnly firmada (24 h)
POST   /api/e/:slug/photos        FormData: display, thumb, sha256, deviceId, name
GET    /api/e/:slug/photos        ?cursor=  → 48 fotos + URLs de miniatura
GET    /api/e/:slug/file/:id      original con cookie; ETag y Cache-Control
GET    /api/thumb/:id             miniatura (fallback local)
PATCH  /api/admin/photos/:id      { status } ocultar/restaurar
DELETE /api/admin/photos/:id      borra objetos + fila
PATCH  /api/admin/event           abrir/cerrar subidas, visibilidad
```

Detalles:

```ts
// POST /api/e/[slug]/photos
const form = await request.formData();
const display = form.get('display');
const thumb = form.get('thumb');
if (!(display instanceof File) || !(thumb instanceof File)) {
  return apiError('Faltan los archivos', 400);
}

const id = crypto.randomUUID();
const keys = objectKeys(event.id, id);
await putPhotoObjects(keys, display, thumb);

const row = await insertPhoto({ id, eventId: event.id, ...keys, ... });
if (!row) {
  // Otra pestaña subió la misma foto entre el chequeo y el insert.
  await deleteObjects([keys.display]);
  await deleteThumbObjects([keys.thumb]);
  return json({ duplicate: true, item: toItem(await getPhotoByHash(event.id, sha256)) });
}
```

```ts
// GET /api/e/[slug]/file/[id]
const object = await env.ORIGINALS.get(photo.display_key);
if (request.headers.get('if-none-match') === object.httpEtag) {
  return new Response(null, { status: 304 });
}
return new Response(object.body, {
  headers: {
    'content-type': 'image/jpeg',
    'cache-control': 'private, max-age=31536000, immutable',
    etag: object.httpEtag,
    'x-robots-tag': 'noindex',
  },
});
```

### Sesión

Cookie `fb_session` = `base64url(payload).base64url(HMAC-SHA256(payload))`, con `{ eid, role, exp }`, usando `crypto.subtle`. Flags: `HttpOnly; Secure` en producción, `SameSite=Lax`. La verificación usa `crypto.subtle.verify` (timing-safe) y revisa `exp` en el servidor.

### Límites anti-abuso

- 5 intentos de código por IP por minuto.
- 300 fotos por `device_id` en total.
- Solo `image/jpeg` de salida (el cliente siempre comprime), máximo 8 MB.
- `device_id` = UUID en `localStorage`; si se borra, se pierde el cupo, nada más.

---

## 8. Seguridad, privacidad y moderación

- **No indexable:** `noindex` + `X-Robots-Tag`, slug aleatorio (`ana-y-luis-7f3k`), `robots.txt` que bloquea todo.
- **Código de evento** además del slug.
- **EXIF/GPS fuera** desde la compresión.
- **Bucket de originales privado**, servido solo con cookie.
- **Miniaturas:** 480 px, URL UUID, dominio separado. Documentar el tradeoff.
- **Aviso corto** al subir: "Al subir, autorizas a Ana y Luis a usar estas fotos. Puedes pedir que se borren."
- **Borrado propio:** token en `localStorage` por dispositivo (pendiente en el scaffold; la API de admin ya cubre el borrado).
- **Moderación:** los novios ocultan o eliminan. Modos:
  - `open`: todos ven todo (más divertido, más riesgo).
  - `surprise`: durante la fiesta solo los novios ven; al día siguiente se abre. Muy buen gancho emocional.
  - `closed`: la galería queda cerrada.
- **Headers:** CSP, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restrictiva.
- **Legal:** para una boda privada alcanza con un aviso claro y un canal de borrado. Si se vuelve producto, cambian términos, retención y encargado de tratamiento.

---

## 9. Operación el día del evento

### Antes
- Probar en teléfonos reales: iPhone reciente, iPhone viejo, Samsung, Android chino; WiFi y 4G.
- Probar HEIC, ráfaga de 50, poca batería, modo avión a mitad de subida, cerrar y reabrir la pestaña.
- **Load test:** 20 subidas paralelas + 50 visitas a la galería.
- **Dry run en el salón**, con la red del salón. No en casa.
- QR: mínimo 4×4 cm, alto contraste, URL escrita abajo, corrección H. Probar a 1,5 m con 3 teléfonos.
- Cantidad: uno por mesa + dos en la entrada + uno en el baño (funciona).

### Durante
- Los novios con el panel abierto, mirando el contador.
- Un "capitán de fotos" que arengue en la cena. Mueve más la aguja que cualquier feature.
- Anuncio del DJ + muro en vivo en una TV: la gente sube cuando se ve en pantalla.
- Cartel de respaldo: "Si no carga, espera y reintenta; se guarda solo".

### Después
1. Cerrar subidas (`uploads_open = 0`).
2. Exportar y verificar: cantidad de objetos en R2 = filas en D1.
3. **Dos backups** en lugares distintos.
4. Abrir la galería, agradecer, compartir el link.
5. Guardar el repo como plantilla para el próximo evento.

```bash
# scripts/export.sh
set -euo pipefail
STAMP=$(date +%F)
wrangler d1 export fotobag --remote --output "backup-$STAMP.sql"
rclone copy r2:fotobag-originals "./export/$STAMP/originals" --progress
rclone copy r2:fotobag-thumbs    "./export/$STAMP/thumbs"    --progress
```

---

## 10. Plan de trabajo (~26-36 h)

| Etapa | Entregable | Tiempo |
|---|---|---|
| S0 | Cuentas, buckets, D1, dominio, deploy vacío | 2-3 h |
| S1 | Esquema D1, sesión, endpoint de subida, compresión, cola | 10-12 h |
| S2 | Galería SSR + paginación, originales, admin, moderación | 8-10 h |
| S3 | PWA, QR imprimible, diseño mobile-first, accesibilidad | 4-6 h |
| S4 | Pruebas en dispositivos reales, load test, dry run | 4-6 h |
| S5 | Evento, exportación, backups, cierre | 2-3 h |

Las etapas S0-S2 ya están cubiertas por el scaffold de este repo. Falta la puesta a punto en dispositivos reales y el dry run.

**Si la boda es en menos de 2 semanas:** priorizar S3 y S4. Si es en menos de 5 días, usar Weduploader/GuestPix y construir esto para la próxima.

### Criterios de aceptación
- [ ] 50 fotos desde un iPhone con 4G en < 90 s, sin errores.
- [ ] HEIC sube y se ve bien (no acostada).
- [ ] Cerrar la pestaña a mitad de subida y reabrir: la cola se retoma.
- [ ] 20 subidas simultáneas: cero 5xx.
- [ ] Galería: primera página < 1,5 s en 4G; scroll fluido con 5.000 fotos.
- [ ] Sin sesión, un `id` de foto no devuelve la imagen original.
- [ ] Backup restaurable en una máquina limpia.
- [ ] QR escaneable a 1,5 m con 3 teléfonos distintos.

---

## 11. Costos

| Ítem | Costo |
|---|---|
| Dominio (`fotos-nuestra-boda.com`) | US$ 10-15/año |
| Workers / R2 / D1 free tier | US$ 0 |
| Impresión de QR y carteles | US$ 10-30 |
| Reserva por excedente (20 GB en R2) | ~US$ 0,30/mes |
| Workers paid, solo si se necesitara | US$ 5/mes |
| **Total esperado** | **< US$ 50** |

A este volumen, pagar R2 es más barato que cualquier trabajo extra para "entrar en el free tier".

---

## 12. Riesgos y mitigaciones

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| WiFi del salón saturado | Alta | Alto | Cola + reintentos; compresión; dry run en el lugar |
| HEIC no soportado | Media | Alto | `heic2any` condicional; detectar y avisar |
| Se llena el free tier | Media | Medio | Compresión; límites por dispositivo; tarjeta en R2 (centavos) |
| Pérdida de fotos | Baja | **Crítico** | Idempotencia + verificación + dos backups |
| Límite de 100k req/día | Baja | Alto | Miniaturas por dominio de R2; Workers paid si hiciera falta |
| Free tier suspendido | Baja | Alto | Buckets S3-compatibles; export completo al final |
| Repo inflado por fotos | Baja | Medio | Fotos nunca en git; `.gitignore` |
| Spam/abuso | Baja | Medio | Código, topes por dispositivo, moderación |
| Privacidad (menores, GPS) | Media | Alto | EXIF fuera, originales privados, borrado, aviso |
| Invitados no participan | Media | Alto | Carteles, anuncio, muro en vivo, capitán de fotos |
| Falta de tiempo | Media | Alto | Alcance congelado; plan B no-code listo |

---

## 13. Decisiones pendientes

1. **¿Fecha y cantidad de invitados?** Dimensiona storage, límites y tiempos.
2. **¿Galería abierta durante la fiesta o modo sorpresa?**
3. **¿Originales o 2560 px?** (se recomienda 2560 px)
4. **¿Miniaturas públicas o privadas?** (se recomienda públicas + originales privados)
5. **¿Dominio propio?** (se recomienda sí: `fotos.tuboda.com` es parte del recuerdo)
6. **¿Un evento o producto multi-evento?** (se recomienda un evento, pero con `event_id` en todo el modelo)

---

## 14. Si esto se vuelve producto

Competencia: Weduploader, GuestPix, Wedbox, álbumes compartidos de Google/Apple. Todos resuelven "QR → fotos"; casi ninguno resuelve bien **el invitado mayor, la mala señal y la entrega final**.

Diferenciadores:
- Onboarding de un toque, sin cuenta, probado en gama baja.
- Muro en vivo + slideshow automático.
- Entrega final: álbum web + ZIP + opción de impresión.
- Precio por evento (no suscripción); plan white-label para planners.
- Multi-idioma (es/en/pt) desde el día uno.

Modelo: gratis hasta 100 fotos / 1 evento; pago único de US$ 29-49 por evento con storage extendido; B2B para planners.

Antes de escribir una línea de SaaS: hacer **un** evento real, medir las métricas del punto 1 y recién entonces generalizar. El 90% del valor está en los detalles de la noche, no en el dashboard.

---

## 15. Notas de implementación (Astro 7)

- Astro 7 reemplazó los bloques `{#if}` / `{#each}` por **expresiones JSX**:

  ```astro
  {allowed ? (
    <Uploader client:load />
  ) : (
    <CodeGate />
  )}

  {items.map((item) => <li>{item.name}</li>)}
  ```

- El adapter de Cloudflare **ya no soporta Pages**. Se deploya a Workers con static assets.
- `Astro.locals.runtime` fue removido: los bindings se importan con `import { env } from 'cloudflare:workers'`.
- `astro dev` y `astro preview` corren sobre `workerd` (runtime real), no sobre Node.
- `wrangler types` genera `worker-configuration.d.ts`; el archivo está en `.gitignore` y se regenera con `npm run check` o `npm run dev`.
