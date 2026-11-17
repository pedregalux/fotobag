-- Evento de ejemplo. Acceso solo por el link del QR (sin código de invitado).
-- Es un upsert: volver a correr el seed actualiza el evento sin perder fotos.
INSERT INTO events (id, slug, title, couple_names, event_date, visibility, uploads_open)
VALUES (
  'evt_demo',
  'mabel-y-belmar',
  'Mabel y Belmar',
  'Mabel & Belmar',
  '2026-12-12',
  'open',
  1
)
ON CONFLICT(id) DO UPDATE SET
  slug = excluded.slug,
  title = excluded.title,
  couple_names = excluded.couple_names,
  event_date = excluded.event_date;
