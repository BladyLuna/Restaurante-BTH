#!/usr/bin/env bash
# Verificación de B6 catalog por HTTP.
# Requiere la API corriendo y el seed cargado.
set -u
API=http://localhost:3000

# Extrae un campo del JSON con python: un sed greedy agarra "categoryId"
# cuando se busca "id", porque el patrón calza dentro del nombre más largo.
campo() { python3 -c 'import sys,json; print(json.load(sys.stdin).get(sys.argv[1],""))' "$1"; }
tok() { curl -s -m 10 -X POST $API/auth/login -H 'Content-Type: application/json' -d "{\"pin\":\"$1\"}" | campo token; }
code() { curl -s -m 10 -o /dev/null -w '%{http_code}' "$@"; }

ADMIN=$(tok 739204)
CAJA=$(tok 482917)
AH="Authorization: Bearer $ADMIN"
CH="Authorization: Bearer $CAJA"
JSON='Content-Type: application/json'

# Limpieza previa: el script debe poder correrse varias veces.
docker exec restaurante_db psql -U restaurante -d restaurante -q -c \
  "DELETE FROM audit_logs WHERE \"productId\" IN (SELECT p.id FROM products p JOIN categories c ON p.\"categoryId\"=c.id WHERE c.nombre LIKE 'VERIF%');
   DELETE FROM product_variants WHERE \"productId\" IN (SELECT p.id FROM products p JOIN categories c ON p.\"categoryId\"=c.id WHERE c.nombre LIKE 'VERIF%');
   DELETE FROM products WHERE \"categoryId\" IN (SELECT id FROM categories WHERE nombre LIKE 'VERIF%');
   DELETE FROM categories WHERE nombre LIKE 'VERIF%';" > /dev/null 2>&1

echo "1) GET /catalog sin token              -> $(code $API/catalog) (espera 200)"
echo "2) GET /admin/catalog sin token        -> $(code $API/admin/catalog) (espera 401)"
echo "3) GET /admin/catalog con CAJA         -> $(code -H "$CH" $API/admin/catalog) (espera 403)"
echo "4) GET /admin/catalog con ADMIN        -> $(code -H "$AH" $API/admin/catalog) (espera 200)"
echo "5) crear plato con CAJA                -> $(code -X POST -H "$CH" -H "$JSON" -d '{"categoryId":"x","nombre":"Hack","precioBolivianos":1}' $API/admin/products) (espera 403)"

CAT=$(curl -s -m 10 -X POST -H "$AH" -H "$JSON" -d '{"nombre":"VERIF Pruebas"}' $API/admin/categories | campo id)
echo "6) crear categoria con ADMIN           -> ${CAT:+OK} ($CAT)"

echo "7) precio con centavos (45.42)         -> $(code -X POST -H "$AH" -H "$JSON" -d "{\"categoryId\":\"$CAT\",\"nombre\":\"Malo\",\"precioBolivianos\":45.42}" $API/admin/products) (espera 400)"
echo "   mensaje:" $(curl -s -m 10 -X POST -H "$AH" -H "$JSON" -d "{\"categoryId\":\"$CAT\",\"nombre\":\"Malo\",\"precioBolivianos\":45.42}" $API/admin/products | head -c 150)

PROD=$(curl -s -m 10 -X POST -H "$AH" -H "$JSON" -d "{\"categoryId\":\"$CAT\",\"nombre\":\"VERIF Pique\",\"precioBolivianos\":45}" $API/admin/products | campo id)
PRECIO=$(curl -s -m 10 -X GET -H "$AH" $API/admin/catalog | python3 -c 'import sys,json
for c in json.load(sys.stdin):
    for p in c["productos"]:
        if p["nombre"]=="VERIF Pique": print(p["precioCentavos"])')
echo "8) crear plato Bs 45                   -> ${PROD:+OK}, precioCentavos=$PRECIO (espera 4500)"

echo "9) cambiar precio a Bs 50              -> $(code -X PUT -H "$AH" -H "$JSON" -d '{"precioBolivianos":50}' $API/admin/products/$PROD) (espera 200)"
echo "10) desactivar plato                   -> $(code -X PATCH -H "$AH" -H "$JSON" -d '{"activo":false}' $API/admin/products/$PROD) (espera 204)"
echo "11) ya no aparece en /catalog          -> $(curl -s -m 10 $API/catalog | grep -c 'VERIF Pique') (espera 0)"
echo "12) sigue en /admin/catalog            -> $(curl -s -m 10 -H "$AH" $API/admin/catalog | grep -c 'VERIF Pique') (espera 1)"
echo "13) reactivar                          -> $(code -X PATCH -H "$AH" -H "$JSON" -d '{"activo":true}' $API/admin/products/$PROD) (espera 204)"
echo "14) vuelve a /catalog                  -> $(curl -s -m 10 $API/catalog | grep -c 'VERIF Pique') (espera 1)"

VAR=$(curl -s -m 10 -X POST -H "$AH" -H "$JSON" -d '{"nombre":"Grande","precioBolivianos":60}' $API/admin/products/$PROD/variants | campo id)
echo "15) crear variante                     -> ${VAR:+OK}"

AUD=$(docker exec restaurante_db psql -U restaurante -d restaurante -t -A -c \
  "SELECT count(*) FROM audit_logs WHERE \"productId\"='$PROD' AND accion='PRECIO_CAMBIADO';" 2>/dev/null)
echo "16) auditoria del cambio de precio     -> $AUD fila(s) (espera 1)"
echo "17) no existe DELETE de plato          -> $(code -X DELETE -H "$AH" $API/admin/products/$PROD) (espera 404)"
