"""Lee un campo de nivel superior de un JSON que llega por stdin.

Existe porque un `sed` con regex greedy capturaba `categoryId` cuando se le
pedia `id` (bug real de verificar-b6.sh). Parsear el JSON de verdad es mas
corto que acertar con la expresion regular.
"""
import json
import sys

campo = sys.argv[1]
try:
    datos = json.load(sys.stdin)
except json.JSONDecodeError:
    print("")
    sys.exit(0)

if isinstance(datos, dict):
    print(datos.get(campo, ""))
else:
    print("")
