"""Del catalogo publico, devuelve 'id|nombre|precioCentavos' del primer plato
SIN variantes: los que tienen variantes necesitan elegir tamano y no sirven
para una prueba de un solo paso (RQ-208).
"""
import json
import sys

catalogo = json.load(sys.stdin)
for categoria in catalogo:
    for producto in categoria.get("productos", []):
        variantes = producto.get("variantes") or []
        if variantes:
            continue
        precio = producto.get("precioBase") or producto.get("precio")
        if precio:
            print(f"{producto['id']}|{producto['nombre']}|{precio}")
            sys.exit(0)
print("||")
