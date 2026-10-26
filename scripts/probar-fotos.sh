#!/usr/bin/env bash
# Prueba de punta a punta: foto de plato (RQ-206) y branding del local (B5).
# Uso: bash scripts/probar-fotos.sh
set -u
API=http://localhost:3000
TMP="${TMPDIR:-/tmp}"

tok() { curl -s -m 10 -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"pin\":\"$1\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))'; }

T=$(tok 739204)
[ -z "$T" ] && { echo "No se pudo autenticar. La API esta levantada?"; exit 1; }
A="Authorization: Bearer $T"
J='Content-Type: application/json'

# PNG valido de 2x2 generado con zlib, sin dependencias externas.
python3 - "$TMP/foto.b64" <<'PY'
import sys, struct, zlib, base64
def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))
w = h = 2
raw = b''.join(b'\x00' + bytes([200, 60, 40] * w) for _ in range(h))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw))
       + chunk(b'IEND', b''))
open(sys.argv[1], 'w').write(base64.b64encode(png).decode())
PY
B64=$(cat "$TMP/foto.b64")

PID=$(curl -s -m 10 $API/admin/catalog -H "$A" | python3 -c '
import sys,json; c=json.load(sys.stdin); print(c[0]["productos"][0]["id"])')
PNOM=$(curl -s -m 10 $API/admin/catalog -H "$A" | python3 -c '
import sys,json; c=json.load(sys.stdin); print(c[0]["productos"][0]["nombre"])')

echo "Plato de prueba: $PNOM"
echo

echo "1. Subir foto (ADMIN)                     espera 200 + imagenUrl"
curl -s -m 20 -X PUT "$API/admin/products/$PID/foto" -H "$A" -H "$J" \
  -d "{\"mime\":\"image/png\",\"base64\":\"$B64\"}" | head -c 200
echo

echo "2. Kiosco PUBLICO ve la foto (sin token)  espera 200 image/png"
URL=$(curl -s -m 10 $API/catalog | python3 -c "
import sys,json
d=json.load(sys.stdin)
for c in d:
    for p in c['productos']:
        if p['id']=='$PID': print(p['imagenUrl'] or ''); raise SystemExit
")
echo "   imagenUrl publica: $URL"
curl -s -m 10 -D - -o /dev/null "$API$URL" | grep -iE "^HTTP|content-type|cache-control|etag" | sed 's/^/   /'

echo
echo "3. Un archivo que NO es imagen            espera 400"
NOIMG=$(printf '<?php echo 1; ?>' | base64 -w0)
curl -s -m 10 -o /dev/null -w "   HTTP %{http_code}\n" -X PUT "$API/admin/products/$PID/foto" \
  -H "$A" -H "$J" -d "{\"mime\":\"image/png\",\"base64\":\"$NOIMG\"}"

echo "4. CAJA intenta subir foto                espera 403"
TC=$(tok 482917)
curl -s -m 10 -o /dev/null -w "   HTTP %{http_code}\n" -X PUT "$API/admin/products/$PID/foto" \
  -H "Authorization: Bearer $TC" -H "$J" -d "{\"mime\":\"image/png\",\"base64\":\"$B64\"}"

echo "5. Plato inexistente                      espera 404"
curl -s -m 10 -o /dev/null -w "   HTTP %{http_code}\n" -X PUT "$API/admin/products/noexiste/foto" \
  -H "$A" -H "$J" -d "{\"mime\":\"image/png\",\"base64\":\"$B64\"}"

echo
echo "6. BRANDING: cambiar nombre del local     espera 200"
curl -s -m 10 -X PUT "$API/admin/settings/branding" -H "$A" -H "$J" \
  -d '{"nombreLocal":"Pollos Dona Marta"}' | head -c 200
echo
echo "7. Subir logo                             espera 200 + logoUrl"
curl -s -m 20 -X PUT "$API/admin/settings/branding" -H "$A" -H "$J" \
  -d "{\"logo\":{\"mime\":\"image/png\",\"base64\":\"$B64\"}}" | head -c 200
echo
echo "8. Kiosco PUBLICO ve el branding          espera 200"
curl -s -m 10 $API/settings/branding | head -c 200
echo
echo "9. Logo publico sin token                 espera 200 image/png"
curl -s -m 10 -D - -o /dev/null "$API/settings/branding/logo" | grep -iE "^HTTP|content-type" | sed 's/^/   /'

echo
echo "10. Quitar la foto del plato              espera 204"
curl -s -m 10 -o /dev/null -w "   HTTP %{http_code}\n" -X DELETE "$API/admin/products/$PID/foto" -H "$A"
echo "11. La foto ya no esta                    espera 404"
curl -s -m 10 -o /dev/null -w "   HTTP %{http_code}\n" "$API/catalog/products/$PID/foto"
echo "12. El plato sigue existiendo y vendible  espera True"
curl -s -m 10 $API/catalog | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('   visible en kiosco:', any(p['id']=='$PID' for c in d for p in c['productos']))
"
rm -f "$TMP/foto.b64"
