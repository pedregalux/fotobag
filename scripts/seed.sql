-- Evento de ejemplo. Código de acceso: 1234
-- El hash es sha256("<slug>:<codigo>"), calculado en el servidor con Web Crypto.
INSERT OR IGNORE INTO events (id, slug, title, couple_names, event_date, code_hash, visibility, uploads_open)
VALUES (
  'evt_demo',
  'ana-y-luis',
  'Ana y Luis',
  'Ana & Luis',
  '2026-12-12',
  'a2de7269887036dcbc8d7099d16f3b238a46ca7604fa7ed4438f829cb7205fe6',
  'open',
  1
);
