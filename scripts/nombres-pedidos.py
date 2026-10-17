"""Muestra los pedidos de una busqueda por monto con la senal que permite
desempatarlos: hora, nombre e items (PLAN §5b, R-01).
"""
import json
import sys

r = json.load(sys.stdin)
for pedido in r.get("pedidos", []):
    hora = (pedido.get("creadoEn") or "")[11:16]
    nombre = pedido.get("nombreCliente") or "sin nombre"
    items = ", ".join(
        f"{i['cantidad']}x {i['nombre']}" for i in pedido.get("items", [])
    )
    print(f"      #{pedido['numero']}  {hora}  {nombre}  ({items})")
