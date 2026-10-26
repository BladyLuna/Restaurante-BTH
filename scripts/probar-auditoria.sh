#!/usr/bin/env bash
# Genera eventos de auditoria reales y muestra el reporte.
# Uso: bash scripts/probar-auditoria.sh
set -u
API=http://localhost:3000
PIN_DUENA=739204

tok() { curl -s -m 10 -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"pin\":\"$1\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))'; }

T=$(tok $PIN_DUENA)
if [ -z "$T" ]; then echo "No se pudo autenticar. La API esta levantada?"; exit 1; fi
AUTH="Authorization: Bearer $T"
JSON='Content-Type: application/json'

echo "1. Tomando un plato del catalogo"
read -r PID PNOMBRE PRECIO <<<"$(curl -s -m 10 $API/admin/catalog -H "$AUTH" | python3 -c '
import sys,json
cats=json.load(sys.stdin)
for c in cats:
    for p in c["productos"]:
        print(p["id"], p["nombre"].replace(" ","_"), p["precioCentavos"]//100); raise SystemExit
')"
echo "   $PNOMBRE  (Bs $PRECIO)"

NUEVO=$((PRECIO + 5))
echo "2. Cambiando el precio: Bs $PRECIO -> Bs $NUEVO   (escribe PRECIO_CAMBIADO)"
curl -s -m 10 -o /dev/null -X PUT "$API/admin/products/$PID" -H "$AUTH" -H "$JSON" \
  -d "{\"precioBolivianos\":$NUEVO}"

echo "3. Desactivando el plato                          (escribe PRODUCTO_DESACTIVADO)"
curl -s -m 10 -o /dev/null -X PATCH "$API/admin/products/$PID/activo" -H "$AUTH" -H "$JSON" \
  -d '{"activo":false}'

echo "4. Reactivandolo                                  (escribe PRODUCTO_ACTIVADO)"
curl -s -m 10 -o /dev/null -X PATCH "$API/admin/products/$PID/activo" -H "$AUTH" -H "$JSON" \
  -d '{"activo":true}'

echo "5. Devolviendo el precio original"
curl -s -m 10 -o /dev/null -X PUT "$API/admin/products/$PID" -H "$AUTH" -H "$JSON" \
  -d "{\"precioBolivianos\":$PRECIO}"

echo
echo "────────────────────────────────────────────────────────"
echo "  REPORTE: GET /admin/audit?grupo=CARTA&dias=1"
echo "────────────────────────────────────────────────────────"
curl -s -m 10 "$API/admin/audit?grupo=CARTA&dias=1" -H "$AUTH" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("contadores:",d["totales"])
print()
for e in d["entradas"]:
    autor=e["autor"] or "el sistema"
    rol=e["rolAutor"] or "-"
    print("  [%s] %s" % (e["grupo"], e["resumen"]))
    print("           por %s (%s) - %s" % (autor, rol, e["creadoEn"][11:16]))
print()
print("siguienteCursor:",d["siguienteCursor"])
'

echo
echo "Permisos: CAJA no puede leer el registro (espera 403)"
TC=$(tok 482917)
echo -n "  CAJA  -> HTTP "
curl -s -m 10 -o /dev/null -w '%{http_code}\n' "$API/admin/audit" -H "Authorization: Bearer $TC"
echo -n "  ADMIN -> HTTP "
curl -s -m 10 -o /dev/null -w '%{http_code}\n' "$API/admin/audit" -H "$AUTH"
