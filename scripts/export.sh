#!/usr/bin/env bash
# Exporta metadata y fotos. Ejecutar después del evento.
#
# Requisitos:
#   - wrangler autenticado
#   - rclone configurado con un remote S3 para R2 (provider = Cloudflare)
#
#   rclone config create r2 s3 provider=Cloudflare \
#     access_key_id=<R2_ACCESS_KEY> secret_access_key=<R2_SECRET> \
#     endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
set -euo pipefail

STAMP=${1:-$(date +%F)}
DEST="./export/$STAMP"

mkdir -p "$DEST"

echo "→ Exportando D1"
npx wrangler d1 export fotobag --remote --output "$DEST/fotobag.sql"

echo "→ Copiando originales"
rclone copy r2:fotobag-originals "$DEST/originals" --progress

echo "→ Copiando miniaturas"
rclone copy r2:fotobag-thumbs "$DEST/thumbs" --progress

echo "→ Verificando conteos"
OBJ=$(find "$DEST/originals" -type f -name 'd.jpg' | wc -l | tr -d ' ')
ROWS=$(npx wrangler d1 execute fotobag --remote --json \
  --command "SELECT COUNT(*) AS n FROM photos" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s)[0].results[0].n)}catch{console.log('?')}})")

echo "objetos: $OBJ"
echo "filas:   $ROWS"

if [ "$OBJ" != "$ROWS" ]; then
  echo "⚠️  Los conteos no coinciden. Revisar antes de borrar nada."
  exit 1
fi

echo "✅ Listo. Guarda DOS copias en lugares distintos."
