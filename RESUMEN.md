# Fotobag — Resumen del plan

> Extracto de `PLAN.md`. Fecha: 17/11/2026.
> Stack: **Astro 7 + Cloudflare Workers + R2 + D1**, con GitHub como repo y CI.
> Estado: **esqueleto implementado y probado** (subida, galería y panel funcionan en local).

## Lo importante

**El hosting gratis es la parte fácil. Lo que decide el proyecto es la compresión en el teléfono.** Sin comprimir, 120 invitados generan ~13 GB (no entra en ningún free tier) y las subidas se cuelgan con mala señal. Comprimiendo a 2560 px en el navegador quedan ~4 GB, todo gratis y rápido.

| Capa | Elección | Motivo |
|---|---|---|
| Front | **Astro 7 en Cloudflare Workers** | HTML estático por defecto; islas solo donde hace falta JS |
| Isla | Svelte 5 | El uploader tiene estado real (cola, progreso, reintentos) |
| Fotos | **Cloudflare R2** (2 buckets) | 10 GB gratis y **egress sin costo** |
| Metadata | **Cloudflare D1** | ~5.000 filas; SQLite en el edge |
| Deploy | GitHub → Workers Builds | Publica en cada push |

El invitado envía un `FormData` con la foto ya comprimida y la miniatura; el Worker valida, guarda en R2 por streaming e inserta la fila en D1 en un solo request. **Miniaturas públicas** (dominio de R2, cacheadas en el edge, no gastan invocaciones) y **originales privados** detrás de una ruta con cookie firmada.

**GitHub no hospeda las fotos:** repo inflado para siempre, 100 MB por archivo, LFS 1 GB y ningún control de acceso. GitHub Pages tampoco sirve: solo estático, sin API ni secretos.

**Flujo del invitado:** QR → landing con dos botones grandes ("Tomar foto" / "Elegir de mi galería") → comprime → sube de a 3 con confirmación por foto → galería. Sin app, sin cuenta, con código de 4-6 dígitos.

## Cómo probarlo

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- Evento: `/e/mabel-y-belmar`
- Código de invitado: **1234**
- Panel: `/admin` → clave **1234**

Detalles en `README.md`.

## Las 3 cosas que suelen arruinar la noche

1. **El WiFi del salón.** Cola con reintentos en IndexedDB, compresión agresiva y dry run *en el lugar*, no en casa.
2. **HEIC de iPhone.** Safari a veces no convierte: fallback con `heic2any` y mensaje claro.
3. **Que nadie suba.** Un cartel por mesa, un anuncio por micrófono, un "capitán de fotos" y un **muro en vivo en una TV** mueven más la aguja que cualquier feature.

Y lo no negociable: al terminar, exportar todo (`wrangler d1 export` + `rclone`), verificar que los objetos coincidan con las filas y guardar **dos copias**. Que el recuerdo de la boda viva solo en un free tier es el único riesgo verdaderamente caro.

## Lo que falta

- Pruebas en teléfonos reales y load test (S4 del plan).
- Dry run en el salón e impresión del QR.
- Muro en vivo, descarga ZIP, video corto y multi-evento (v1/futuro).

## Decisiones pendientes

1. ¿Fecha y cantidad de invitados?
2. ¿Galería abierta durante la fiesta o **modo sorpresa**?
3. ¿Guardar originales o alcanza con 2560 px?
4. ¿Miniaturas públicas o privadas? (se recomienda públicas + originales privados)
