-- Evento de ejemplo. Código de acceso: 1234
-- El hash es sha256("<slug>:<codigo>"), calculado en el servidor con Web Crypto.
-- Es un upsert: volver a correr el seed actualiza el evento sin perder fotos.
INSERT INTO events (id, slug, title, couple_names, event_date, code_hash, visibility, uploads_open)
VALUES (
  'evt_demo',
  'mabel-y-belmar',
  'Mabel y Belmar',
  'Mabel & Belmar',
  '2026-12-12',
  'c3cb34c7042163c9b3bae79e6bc301dd39a9577088b6deed498ff8bc75fee70a',
  'open',
  1
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  title = excluded.title,
  couple_names = excluded.couple_names,
  event_date = excluded.event_date,
  code_hash = excluded.code_hash;
