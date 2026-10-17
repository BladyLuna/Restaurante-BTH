import sys, json

# Cuenta cuantas veces aparece un plato por nombre exacto, no por grep:
# el JSON viene en una sola linea y grep -c solo dice "hay o no hay".
buscado = sys.argv[1]
n = 0
for cat in json.load(sys.stdin):
    for p in cat['productos']:
        if p['nombre'] == buscado:
            n += 1
print(n)
