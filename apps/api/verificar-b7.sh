#!/usr/bin/env bash
# Verificación de B7 (orders) por HTTP.
# Fuente: docs/sprints/S3-pedidos.md, RQ-301 a RQ-312.
#
# Prueba contra la API corriendo lo que los tests ya prueban contra la base,
# pero atravesando guards, validación Zod y serialización. Es la diferencia
# entre "el servicio funciona" y "la API funciona".
#
# Uso:  bash apps/api/verificar-b7.sh
set -u

API=http://localhost:3000
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
JSON='Content-Type: application/json'

# Los PIN de desarrollo los imprime el seed; se leen de la base para no
# escribirlos en el repo.
PIN_ADMIN="${PIN_ADMIN:-739204}"
PIN_CAJA="${PIN_CAJA:-482917}"

paso() { printf '\n== %s\n' "$1"; }
campo() { python3 "$DIR/scripts/campo.py" "$1"; }

login() {
  curl -s -m 10 -X POST -H "$JSON" -d "{\"pin\":\"$1\"}" "$API/auth/login" \
    | campo token
}

uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }

# ---------------------------------------------------------------------------
paso "0. Sesiones"
TOK_ADMIN=$(login "$PIN_ADMIN")
TOK_CAJA=$(login "$PIN_CAJA")
[ -n "$TOK_ADMIN" ] && echo "   ADMIN: sesión abierta" || { echo "   ADMIN: FALLÓ el login"; exit 1; }
[ -n "$TOK_CAJA" ] && echo "   CAJA:  sesión abierta" || echo "   CAJA:  FALLÓ el login"
AD="Authorization: Bearer $TOK_ADMIN"
CJ="Authorization: Bearer $TOK_CAJA"

# ---------------------------------------------------------------------------
paso "1. El kiosco pide sin estar logueado (RQ-301, ruta pública)"
PROD=$(curl -s -m 10 "$API/catalog" | python3 "$DIR/scripts/primer-plato.py")
ID_PLATO=$(echo "$PROD" | cut -d'|' -f1)
NOM_PLATO=$(echo "$PROD" | cut -d'|' -f2)
PRECIO=$(echo "$PROD" | cut -d'|' -f3)
echo "   plato del menú: $NOM_PLATO (Bs $((PRECIO / 100)))"

U1=$(uuid)
R1=$(curl -s -m 10 -X POST -H "$JSON" "$API/orders" -d "{
  \"items\":[{\"productId\":\"$ID_PLATO\",\"cantidad\":1}],
  \"nombreCliente\":\"Cliente de prueba\",
  \"tipo\":\"COMER_AQUI\",
  \"intentoUuid\":\"$U1\"}")
ID_PEDIDO=$(echo "$R1" | campo id)
NUM=$(echo "$R1" | campo numero)
TOTAL=$(echo "$R1" | campo total)
echo "   pedido #$NUM creado, total Bs $((TOTAL / 100)), sin token"

# ---------------------------------------------------------------------------
paso "2. El total del cliente se IGNORA (RQ-304, PLAN §6)"
U2=$(uuid)
R2=$(curl -s -m 10 -X POST -H "$JSON" "$API/orders" -d "{
  \"items\":[{\"productId\":\"$ID_PLATO\",\"cantidad\":1}],
  \"nombreCliente\":\"Tramposo\",
  \"tipo\":\"COMER_AQUI\",
  \"totalCliente\":100,
  \"intentoUuid\":\"$U2\"}")
T2=$(echo "$R2" | campo total)
echo "   el cliente dijo Bs 1, el servidor cobró Bs $((T2 / 100))"
[ "$T2" = "$PRECIO" ] && echo "   OK: se recalculó en el servidor" || echo "   FALLA: se usó el total del cliente"

# ---------------------------------------------------------------------------
paso "3. Reintento con el mismo UUID (RQ-303, 'porque el WiFi se va a caer')"
R3=$(curl -s -m 10 -X POST -H "$JSON" "$API/orders" -d "{
  \"items\":[{\"productId\":\"$ID_PLATO\",\"cantidad\":1}],
  \"nombreCliente\":\"Cliente de prueba\",
  \"tipo\":\"COMER_AQUI\",
  \"intentoUuid\":\"$U1\"}")
ID3=$(echo "$R3" | campo id)
[ "$ID3" = "$ID_PEDIDO" ] && echo "   OK: devolvió el pedido #$NUM, no creó otro" \
                          || echo "   FALLA: creó un pedido nuevo"

# ---------------------------------------------------------------------------
paso "4. Nombre obligatorio (D-13)"
code() {
  curl -s -o /dev/null -w "%{http_code}" -m 10 -X "$1" -H "$JSON" "${@:4}" "$2" -d "$3"
}
C=$(code POST "$API/orders" "{\"items\":[{\"productId\":\"$ID_PLATO\",\"cantidad\":1}],\"tipo\":\"COMER_AQUI\",\"intentoUuid\":\"$(uuid)\"}")
echo "   pedido sin nombre -> HTTP $C (se espera 400)"
MSG=$(curl -s -m 10 -X POST -H "$JSON" "$API/orders" \
  -d "{\"items\":[{\"productId\":\"$ID_PLATO\",\"cantidad\":1}],\"nombreCliente\":\"\",\"tipo\":\"COMER_AQUI\",\"intentoUuid\":\"$(uuid)\"}" \
  | campo message)
echo "   mensaje: $MSG"

# ---------------------------------------------------------------------------
paso "5. Cantidad inválida"
C=$(code POST "$API/orders" "{\"items\":[{\"productId\":\"$ID_PLATO\",\"cantidad\":0}],\"nombreCliente\":\"Juan\",\"tipo\":\"COMER_AQUI\",\"intentoUuid\":\"$(uuid)\"}")
echo "   cantidad 0 -> HTTP $C (se espera 400)"
C=$(code POST "$API/orders" "{\"items\":[{\"productId\":\"no-existe\",\"cantidad\":1}],\"nombreCliente\":\"Juan\",\"tipo\":\"COMER_AQUI\",\"intentoUuid\":\"$(uuid)\"}")
echo "   plato inexistente -> HTTP $C (se espera 404)"

# ---------------------------------------------------------------------------
paso "6. El panel de cobro lo usan ADMIN y CAJA (RQ-308)"
SIN=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$API/admin/orders/pendientes")
CON_CAJA=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -H "$CJ" "$API/admin/orders/pendientes")
CON_ADMIN=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -H "$AD" "$API/admin/orders/pendientes")
echo "   sin token  -> HTTP $SIN  (se espera 401)"
echo "   CAJA       -> HTTP $CON_CAJA  (se espera 200: la cajera cobra)"
echo "   ADMIN      -> HTTP $CON_ADMIN  (se espera 200)"
CUANTOS=$(curl -s -m 10 -H "$AD" "$API/admin/orders/pendientes" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
echo "   pendientes en la cola: $CUANTOS"

# ---------------------------------------------------------------------------
paso "7. Buscar por monto y detectar ambigüedad (RQ-311 / R-01)"
BUSCA=$(curl -s -m 10 -H "$AD" "$API/admin/orders/buscar?total=$PRECIO")
AMB=$(echo "$BUSCA" | campo ambiguo)
CANT=$(echo "$BUSCA" | campo cantidad)
echo "   pedidos de Bs $((PRECIO / 100)): $CANT, ambiguo=$AMB"
if [ "$AMB" = "True" ]; then
  echo "   OK: hay dos del mismo monto y el servidor obliga a elegir"
  echo "$BUSCA" | python3 "$DIR/scripts/nombres-pedidos.py"
fi

# ---------------------------------------------------------------------------
paso "8. La cajera NO cancela (RQ-309, PLAN §5c)"
C=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -X POST -H "$JSON" -H "$CJ" \
     "$API/admin/orders/$ID_PEDIDO/cancelar" -d '{"motivo":"intento de la cajera"}')
echo "   CAJA cancelando -> HTTP $C (se espera 403)"

# ---------------------------------------------------------------------------
paso "9. La dueña cancela y queda en auditoría (RQ-309, D-07)"
R9=$(curl -s -m 10 -X POST -H "$JSON" -H "$AD" \
      "$API/admin/orders/$ID_PEDIDO/cancelar" -d '{"motivo":"el cliente se fue"}')
echo "   estado: $(echo "$R9" | campo estado)"
AUDIT=$(docker exec restaurante_db psql -U restaurante -d restaurante -t -A -c \
  "SELECT a.accion || ' | ' || u.nombre || ' | ' || COALESCE(a.detalle->>'motivo','') FROM audit_logs a JOIN users u ON a.\"userId\"=u.id WHERE a.\"orderId\"='$ID_PEDIDO'")
echo "   auditoría: $AUDIT"

# ---------------------------------------------------------------------------
paso "10. Repetir el pedido vencido (RQ-310 / D-12)"
R10=$(curl -s -m 10 -X POST -H "$JSON" -H "$CJ" \
       "$API/admin/orders/$ID_PEDIDO/repetir" -d "{\"intentoUuid\":\"$(uuid)\"}")
NUM10=$(echo "$R10" | campo numero)
EST10=$(echo "$R10" | campo estado)
echo "   el original #$NUM sigue: $(curl -s -m 10 "$API/orders/$ID_PEDIDO/estado" | campo estado)"
echo "   el nuevo es #$NUM10, estado $EST10"
[ "$NUM10" != "$NUM" ] && echo "   OK: creó uno nuevo, no revivió el cancelado" \
                       || echo "   FALLA: reusó el número"

# ---------------------------------------------------------------------------
paso "11. El cliente consulta su pedido (RQ-307, público)"
curl -s -m 10 "$API/orders/$ID_PEDIDO/estado" | python3 -m json.tool

# ---------------------------------------------------------------------------
paso "12. Numeración consecutiva, único por jornada (RQ-302)"
docker exec restaurante_db psql -U restaurante -d restaurante -t -A -c \
  "SELECT 'jornada ' || fecha || ': pedidos #' || string_agg(numero::text, ', #' ORDER BY numero) FROM orders GROUP BY fecha ORDER BY fecha DESC LIMIT 3"
docker exec restaurante_db psql -U restaurante -d restaurante -t -A -c \
  "SELECT 'contador: ultimo numero ' || \"ultimoNumero\" FROM order_counters ORDER BY fecha DESC LIMIT 1"

printf '\n== Listo\n'
