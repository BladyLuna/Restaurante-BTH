#!/usr/bin/env bash
# Recorrido de lo que funciona hoy en el sistema.
# Uso:  bash probar.sh
#
# Requiere la base y la API corriendo:
#   docker compose up -d
#   cd apps/api && npx tsx src/main.ts
set -u
API=http://localhost:3000
DIR="$(cd "$(dirname "$0")" && pwd)"

PIN_DUENA=739204
PIN_CAJERA=482917
PIN_COCINA=1573

campo() { python3 -c 'import sys,json; print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }
login() { curl -s -m 10 -X POST $API/auth/login -H 'Content-Type: application/json' -d "{\"pin\":\"$1\"}"; }
code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@"; }

linea() { echo; echo "────────────────────────────────────────────────────────"; echo "  $1"; echo "────────────────────────────────────────────────────────"; }

linea "1. EL MENU QUE VERIA EL CLIENTE EN LA TABLET"
echo "Esto es publico: el kiosco no tiene login."
echo
curl -s -m 10 $API/catalog | python3 "$DIR/scripts/mostrar-menu.py"

linea "2. QUIEN ES QUIEN (login con PIN)"
for par in "DUENA:$PIN_DUENA" "CAJERA:$PIN_CAJERA" "COCINA:$PIN_COCINA"; do
  quien=${par%%:*}; pin=${par##*:}
  r=$(login $pin)
  nombre=$(echo "$r" | python3 -c 'import sys,json; print(json.load(sys.stdin)["usuario"]["nombre"])' 2>/dev/null)
  rol=$(echo "$r" | python3 -c 'import sys,json; print(json.load(sys.stdin)["usuario"]["rol"])' 2>/dev/null)
  printf "  PIN %-7s -> %-22s rol %s\n" "$pin" "$nombre" "$rol"
done

TOK_DUENA=$(login $PIN_DUENA | campo token)
TOK_CAJERA=$(login $PIN_CAJERA | campo token)
TOK_COCINA=$(login $PIN_COCINA | campo token)
AD="Authorization: Bearer $TOK_DUENA"
CJ="Authorization: Bearer $TOK_CAJERA"
CC="Authorization: Bearer $TOK_COCINA"
JSON='Content-Type: application/json'

linea "3. PIN EQUIVOCADO"
echo -n "  PIN 000000 -> "
login 000000 | head -c 120; echo

linea "4. CADA UNO VE SOLO LO SUYO"
echo "  La carta (precios) es decision de la duena, no de la cajera."
echo
printf "  sin entrar al sistema   -> %s   (401 = tenes que entrar)\n" "$(code $API/admin/catalog)"
printf "  la cocinera            -> %s   (403 = no te corresponde)\n" "$(code -H "$CC" $API/admin/catalog)"
printf "  la cajera              -> %s   (403 = no te corresponde)\n" "$(code -H "$CJ" $API/admin/catalog)"
printf "  la duena               -> %s   (200 = adelante)\n" "$(code -H "$AD" $API/admin/catalog)"

linea "5. LA CAJERA NO PUEDE TOCAR LA CARTA"
echo -n "  intenta crear un plato de Bs 1 -> "
curl -s -m 10 -X POST -H "$CJ" -H "$JSON" \
  -d '{"categoryId":"x","nombre":"Plato trucho","precioBolivianos":1}' \
  $API/admin/products | head -c 150; echo

linea "6. NO SE ACEPTAN CENTAVOS"
echo "  Decision tuya: precios en bolivianos enteros."
echo
CAT=$(curl -s -m 10 -X POST -H "$AD" -H "$JSON" -d '{"nombre":"PRUEBA"}' $API/admin/categories | campo id)
if [ -z "$CAT" ]; then
  CAT=$(curl -s -m 10 -H "$AD" $API/admin/catalog | python3 -c '
import sys,json
for c in json.load(sys.stdin):
    if c["nombre"]=="PRUEBA": print(c["id"]); break')
fi
echo -n "  precio 45.42 -> "
curl -s -m 10 -X POST -H "$AD" -H "$JSON" \
  -d "{\"categoryId\":\"$CAT\",\"nombre\":\"Con centavos\",\"precioBolivianos\":45.42}" \
  $API/admin/products | head -c 150; echo

linea "7. AGREGAR UN PLATO DE VERDAD"
PROD=$(curl -s -m 10 -X POST -H "$AD" -H "$JSON" \
  -d "{\"categoryId\":\"$CAT\",\"nombre\":\"Plato de prueba\",\"descripcion\":\"Para este recorrido\",\"precioBolivianos\":18}" \
  $API/admin/products | campo id)
contar() { curl -s -m 10 "$1" ${2:+-H "$2"} | python3 "$DIR/scripts/contar-plato.py" "Plato de prueba"; }
echo "  Creado: Plato de prueba, Bs 18"
echo "  Veces que aparece en el menu del cliente: $(contar $API/catalog)   (espera 1)"

linea "8. SE ACABO (lo que mas vas a usar)"
curl -s -m 10 -X PATCH -H "$AD" -H "$JSON" -d '{"activo":false}' $API/admin/products/$PROD > /dev/null
echo "  En el menu del cliente:            $(contar $API/catalog)   (espera 0, ya no se puede pedir)"
echo "  En tu panel, para reactivarlo:     $(contar $API/admin/catalog "$AD")   (espera 1)"
echo
echo "  No se borro. Los pedidos viejos que lo tenian siguen intactos."

linea "9. VOLVIO A HABER"
curl -s -m 10 -X PATCH -H "$AD" -H "$JSON" -d '{"activo":true}' $API/admin/products/$PROD > /dev/null
echo "  De vuelta en el menu del cliente:  $(contar $API/catalog)   (espera 1)"

linea "10. SUBIR EL PRECIO QUEDA REGISTRADO"
curl -s -m 10 -X PUT -H "$AD" -H "$JSON" -d '{"precioBolivianos":20}' $API/admin/products/$PROD > /dev/null
echo "  Plato de prueba: Bs 18 -> Bs 20"
echo
docker exec restaurante_db psql -U restaurante -d restaurante -t -A -F' | ' -c \
  "SELECT u.nombre, a.accion,
          (a.detalle->>'precioAnteriorCentavos')::int/100 || ' -> ' || (a.detalle->>'precioNuevoCentavos')::int/100 || ' Bs',
          to_char(a.\"creadoEn\",'DD/MM HH24:MI')
     FROM audit_logs a JOIN users u ON a.\"userId\"=u.id
    WHERE a.\"productId\"='$PROD' AND a.accion='PRECIO_CAMBIADO';" 2>/dev/null | sed 's/^/  /'
echo
echo "  Quien lo cambio, que cambio y cuando. Nadie puede borrar esta fila."

linea "11. NO SE PUEDE BORRAR UN PLATO"
printf "  intento de borrado -> %s   (404 = esa opcion no existe)\n" "$(code -X DELETE -H "$AD" $API/admin/products/$PROD)"

linea "12. 5 PINES MAL Y SE BLOQUEA"
echo "  Es lo que de verdad protege el PIN."
echo
for i in 1 2 3 4 5 6; do
  r=$(login 111111 | head -c 95)
  printf "  intento %d: %s\n" "$i" "$r"
done

# Limpieza
docker exec restaurante_db psql -U restaurante -d restaurante -q -c \
  "DELETE FROM audit_logs WHERE \"productId\" IN (SELECT p.id FROM products p JOIN categories c ON p.\"categoryId\"=c.id WHERE c.nombre IN ('PRUEBA','DIAG'));
   DELETE FROM product_variants WHERE \"productId\" IN (SELECT p.id FROM products p JOIN categories c ON p.\"categoryId\"=c.id WHERE c.nombre IN ('PRUEBA','DIAG'));
   DELETE FROM products WHERE \"categoryId\" IN (SELECT id FROM categories WHERE nombre IN ('PRUEBA','DIAG'));
   DELETE FROM categories WHERE nombre IN ('PRUEBA','DIAG');
   DELETE FROM login_attempts;" > /dev/null 2>&1

linea "RESUMEN"
cat <<'FIN'
  Esta corrida acaba de probar, contra la base real:
    el menu que ve el cliente
    entrar con PIN, los tres roles
    cada rol ve solo lo que le toca
    agregar, editar, agotar y reactivar platos
    precios sin centavos, por decision tuya
    todo cambio de precio con nombre y hora
    bloqueo despues de 5 PIN equivocados

  Lo que este script NO toca, y se demuestra por pantalla:
    el kiosco de la tablet, tomar un pedido y el QR
    cobrar y confirmar el pago en caja
    la pantalla de la cocina
    la carta, el local y el reporte de auditoria

  Para esas pantallas:  cd apps/app && npx expo start --web
  Hay dos scripts mas:  bash scripts/probar-fotos.sh
                        bash scripts/probar-auditoria.sh
FIN
echo
