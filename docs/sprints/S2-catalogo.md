# S2 — Catálogo

**Módulos:** B6 `catalog`, F1 `shared/ui` + `shared/api`
**Estimación:** 9 jornadas (B6 4 j + F1 5 j)
**Estado:** listo para ejecutar. No depende de ninguna decisión abierta
(`REPORTE §16.9`: `B6` y `F1` pueden iniciarse de inmediato).

---

## Objetivo

Que la dueña pueda administrar su carta sola —categorías, platos, variantes,
precios, fotos y orden— y que el frontend tenga la base técnica sobre la que se
construyen las tres superficies: tokens de diseño, componentes de UI y una única
capa de acceso a red.

Al cerrar S2 no hay pedidos todavía. Lo que hay es el catálogo que los pedidos
van a leer, y la base de frontend que no se vuelve a discutir.

---

## B6 — `catalog`

4 jornadas. Fuente: `PLAN §4`, `PLAN §6`, `PLAN §7` (pestaña Menú),
`ARQUITECTURA §2`, `REPORTE ADM-06`.

**Profundidad de slice: controller → service → Prisma directo, sin repositorio.**
Fuente: `ARQUITECTURA §2`, tabla de profundidad variable: `catalog` es CRUD y un
repositorio acá sería "una capa que solo reenvía llamadas". La regla citada es
explícita: la capa se agrega cuando hay lógica que proteger, no por simetría.

### RQ-201 — CRUD de categorías

Fuente: `PLAN §4` (`Category id, nombre, orden, activo`), `PLAN §6`
(`CRUD /admin/categories`).

- Crear, leer, editar nombre y orden.
- Campo `activo`. Una categoría inactiva no aparece en `GET /catalog`.
- Solo ADMIN puede gestionar catálogo (`PLAN §5g`, fila "Gestionar catálogo y
  precios": No para KIOSCO, COCINA y CAJA).

Aceptación:
- Un usuario con rol CAJA o COCINA recibe permiso denegado del servidor, no un
  botón oculto (`PLAN §5g`, "Autorización en el servidor, no en la UI").

Pendiente de decisión: la baja de categorías no está resuelta
(`REPORTE ADM-06`, pendientes: "baja de categorías/variantes"). Mientras no haya
respuesta, solo se implementa `activo = false`; no se expone borrado.

### RQ-202 — CRUD de platos

Fuente: `PLAN §4` (`Product id, categoryId, nombre, descripcion, precioBase,
imagenUrl, activo, orden, tieneVariantes`), `PLAN §6`
(`CRUD /admin/products`).

- Alta y edición de nombre, descripción, categoría y `precioBase`.
- `tieneVariantes` como switch. Fuente: `PLAN §4`, "Variantes opcionales": si es
  `false` el kiosco agrega con `precioBase` en un toque; si es `true` muestra los
  tamaños.
- Edición de precio en una sola operación, pensada para la fila de la lista
  (`PLAN §7`: "tocar el precio, tipear, guardar. No abrir un formulario de ocho
  campos para cambiar Bs 2").

Aceptación:
- Cambiar el precio de un plato no altera ningún `OrderItem` existente (ver
  RQ-208).
- Todo cambio de precio deja fila en `AuditLog` (ver RQ-209).

### RQ-203 — CRUD de variantes

Fuente: `PLAN §4` (`ProductVariant id, productId, nombre ("500ml"), precio,
activo, orden`), `PLAN §6` (`CRUD /admin/products/:id/variants`).

- Alta, edición, orden y `activo` por variante.
- Las variantes se muestran en el panel solo cuando `tieneVariantes = true`
  (`PLAN §4`).

Pendiente de decisión: la baja de variantes queda abierta igual que la de
categorías (`REPORTE ADM-06`).

### RQ-204 — Activar y desactivar, nunca eliminar

Fuente: `PLAN §4`, "Nunca borrar platos"; `PLAN §7`, "Nunca un botón de
eliminar"; `docs/README.md` regla de trabajo 6.

- `activo = false` en lugar de `DELETE`, en `Category`, `Product` y
  `ProductVariant`.
- Motivo citado: un plato borrado dejaría `OrderItem` huérfanos (`PLAN §4`).
- La API **no expone** un endpoint de borrado físico de productos asociados a
  pedidos (`REPORTE ADM-06`, reglas).
- Desactivar es la acción más frecuente del día —se acabó el pollo— y resuelve
  en un solo toque (`PLAN §7`).

Aceptación:
- Un plato desactivado desaparece de `GET /catalog` pero sigue existiendo en la
  base y los pedidos históricos que lo referencian siguen íntegros.

Nota: `PLAN §7` menciona que el borrado real no existe y que solo "se archiva,
detrás de una confirmación aparte", mientras `REPORTE ADM-06` deja como pendiente
"la distinción entre desactivar y archivar". En S2 se implementa únicamente
`activo`. El archivado de productos queda **pendiente de decisión**: falta que se
defina qué significa archivar un plato frente a desactivarlo, y qué efecto tiene
en el panel.

### RQ-205 — Reordenar

Fuente: `PLAN §4` (campo `orden` en `Category`, `Product` y `ProductVariant`),
`PLAN §7`: "Reordenar arrastrando. El orden del menú es decisión comercial suya
(lo que quiere vender va primero)". `PLAN §6`: `CRUD /admin/products` "incluye
activar/desactivar y reordenar".

- Endpoint que acepta el nuevo orden de un conjunto de items.
- La reordenación es del servidor; el cliente manda el orden resultante, no
  índices relativos.

Aceptación:
- `GET /catalog` devuelve categorías, platos y variantes ya ordenados.

### RQ-206 — Subida y redimensionado de fotos

Fuente: `PLAN §5b` ("el servidor valida que sea una imagen y la redimensiona",
dicho de los QR), `PLAN §7` ("Fotos desde la galería o la cámara del celular. Se
suben y se redimensionan en el servidor"), `ARQUITECTURA §4` (`ImageStorage` es
uno de los tres lugares donde sí vale invertir la dependencia).

- Carga multipart desde el panel, pensada para el celular de la dueña.
- El servidor valida que el archivo sea una imagen y la redimensiona.
- El almacenamiento va detrás de la interfaz `ImageStorage`: disco local hoy,
  posible S3/Cloudinary mañana (`ARQUITECTURA §4`). Es una de las tres
  inversiones de dependencia autorizadas; el resto del proyecto usa Prisma
  directo.
- Si un plato no tiene foto, la UI muestra una tarjeta con el nombre en grande,
  nunca un ícono de imagen rota (`PLAN §7`). Esto es requisito de presentación
  que F1 debe soportar con su componente `Card`.

### RQ-207 — Validación de precios múltiplos de 100 centavos

Fuente: D-04, `PLAN §5b` (derogación del sufijo, "Validación nueva: rechazar
precios que no sean múltiplos de 100 centavos"), `REPORTE §16.4` ("Validación
nueva: rechazar precios no múltiplos de 100 en `catalog`"), `PLAN §6`
("Validación"), `PLAN §4` ("Dinero").

- `precioBase` y `ProductVariant.precio` son enteros en centavos y **múltiplos
  de 100**. Bs 45 se guarda como `4500`.
- La validación usa el schema Zod de `packages/shared` (RQ-104 de S1), de modo
  que el rechazo es idéntico en la API y en el cliente (`PLAN §6`).
- No hay sufijo de centavos en ninguna parte: fue derogado (D-04).

Aceptación:
- Un `POST`/`PUT` con precio `4542` es rechazado con error de validación.
- Un precio `4500` es aceptado.

Pendiente de decisión: `REPORTE ADM-06` deja abierta la "validación de precio
cero/negativo". No se inventa la regla: hasta que se responda, se implementa
únicamente el múltiplo de 100. Pregunta que lo desbloquea: ¿puede existir un
plato con precio Bs 0 (cortesía, acompañamiento incluido)?

### RQ-208 — Snapshot de precios: la regla que B7 va a usar

Fuente: `PLAN §4` ("Snapshot de precios"), `ARQUITECTURA §5` (patrón Snapshot),
`REPORTE ADM-06`.

Este requerimiento **no se implementa en B6** —el snapshot lo escribe `orders`
al crear el `OrderItem`, que es S3— pero se documenta acá porque es la razón por
la que B6 puede permitirse editar precios libremente.

- `OrderItem` guarda `nombreSnapshot` y `precioUnitarioSnapshot` (`PLAN §4`).
- Consecuencia para B6: cambiar un precio a mitad del día es una operación
  segura y no requiere versionado de productos. Sin el snapshot, "el reporte de
  ventas y los totales históricos se corrompen cada vez que toca un precio"
  (`PLAN §4`).
- Lo que B6 **debe** exponer para que eso funcione: nombre y precio unitario
  vigentes de plato y variante en el momento de la consulta, de forma que
  `orders` pueda copiarlos. `orders` consulta `catalog` directamente, y eso es
  una dependencia real del dominio, no acoplamiento accidental
  (`ARQUITECTURA §2`, "Comunicación entre slices", excepción pragmática).

### RQ-209 — Auditoría de cambios de precio

Fuente: `PLAN §5c` ("Lo mismo para cancelaciones y cambios de precio"),
`PLAN §7` ("Cada cambio de precio queda en el log de auditoría"), D-07,
`ARQUITECTURA §3`.

- Un cambio de `precioBase` o de `ProductVariant.precio` escribe fila en
  `AuditLog` con `userId`, `productId` y el detalle del cambio.
- **Se escribe dentro de la misma transacción que el cambio de precio**, no por
  listener posterior al commit. Fuente: `ARQUITECTURA §3`, excepción de
  auditoría financiera: la regla alcanza a "una confirmación de pago, una
  cancelación, **un cambio de precio** o un cambio de QR". D-07.
- Motivo citado: el log existe "para poder explicar un cierre que no cuadra"
  (`PLAN §7`).

Aceptación:
- Editar un precio deja la fila de `AuditLog` o no deja el cambio. Nunca una sin
  la otra.

Nota de dependencia: el módulo `B10 audit` es S4. En S2 se escribe la fila con
Prisma dentro de la transacción del servicio de catálogo; lo que S4 agrega es la
consulta del log (`GET /admin/audit`) y las acciones de permisos.

### RQ-210 — `GET /catalog` público

Fuente: `PLAN §6` (`GET /catalog` — categorías + platos activos + variantes, sin
auth, token de dispositivo), `REPORTE CLI-01`.

- Devuelve solo lo `activo`, ordenado por `orden`.
- Sin login de usuario; el kiosco usa token de dispositivo (`PLAN §5g`,
  Dispositivos).
- Filtrado por contexto de local: ninguna query sin filtro de `locationId`
  (`ARQUITECTURA §1`, RQ-115 de S1).

### RQ-211 — Evento `catalog.updated`

Fuente: `PLAN §6` (lista de eventos WebSocket), `PLAN §7` ("Cambios en vivo. Al
guardar, la tablet actualiza el catálogo por WebSocket sin reiniciarse").

- Al guardar un cambio de catálogo se emite `catalog.updated`.
- **Después del commit**, no dentro de la transacción (`ARQUITECTURA §3`: si se
  emite adentro y la transacción falla, el cliente recibió algo que en la base no
  existe).
- El gateway WebSocket es `B11`, que es S4. En S2 se emite el evento de dominio
  en proceso; el transporte se conecta en S4.

Pendiente de decisión: `PLAN §7` dice que "los carritos a medio armar que ya lo
tenían se avisan al confirmar, no se vacían de golpe", y `REPORTE ADM-06` deja
como pendiente el "efecto sobre pedidos pendientes ya creados". El aviso al
confirmar es trabajo de F2/F3 y de B7; en S2 solo se emite el evento.

---

## F1 — `shared/ui` + `shared/api`

5 jornadas. Fuente: `ARQUITECTURA §7`, `MODULOS §1` (F1: "Tokens,
Button/Card/Price, cliente HTTP con reintentos, offline, hooks de WS"),
`PLAN §7`.

**F1 arranca contra API mockeada.** Fuente: `MODULOS §3` y
`docs/sprints/README.md`: "F1 puede arrancar con la API mockeada", y es lo que
permite comprimir el calendario con dos devs. No espera a que B6 esté terminado.

Criterio que gobierna todo F1, de `ARQUITECTURA §7`: **lo que se comparte son las
features, no las pantallas.** El kiosco necesita botones de 72 px y el admin una
tabla densa en un celular; forzar un componente común para las dos termina en un
componente con diez props condicionales.

### RQ-212 — Tokens de diseño

Fuente: `ARQUITECTURA §7` (`shared/ui` — "Button, Card, Price — tokens de
diseño"), `PLAN §7`.

Los valores salen de los criterios ya documentados en `PLAN §7`, no se inventan:

- Área táctil mínima 64×64 px, 72 px para acciones principales (kiosco).
- Cuerpo de texto mínimo 18 px, precios 24 px.
- Contraste alto: la tablet va en la entrada, con luz del sol de costado.
- Escala tipográfica que incluya el tamaño máximo de la app, reservado al monto
  en la pantalla de pago (`PLAN §5b`: "la tablet muestra el monto en el tamaño
  más grande de toda la app").

Aceptación:
- Los tokens existen como fuente única; ninguna pantalla define sus propios px
  de área táctil ni de tipografía.

### RQ-213 — Componentes `Button`, `Card`, `Price`

Fuente: `ARQUITECTURA §7`.

- `Button`: variantes por superficie, respetando el área táctil del token.
- `Card`: la tarjeta de plato del kiosco, con imagen, nombre y precio visibles
  sin tocar nada (`PLAN §7`), y el caso sin foto resuelto con el nombre en grande
  (`PLAN §7`, RQ-206).
- `Price`: formatea usando `Money` de `packages/shared` (RQ-101 de S1). Nunca
  muestra centavos: todos los montos son bolivianos enteros (D-04).
- `Price` **muestra**, no decide. La autoridad del cálculo es del servidor
  (`ARQUITECTURA §6`: "El cliente usa `Money` para mostrar el total, nunca para
  decidirlo").

### RQ-214 — `apiClient` único

Fuente: `ARQUITECTURA §7`, "Todo el acceso a red en una capa". Es uno de los dos
puntos que, según ese documento, definen la robustez del kiosco.

- Un `apiClient` único con **reintentos, timeout y detección de offline**.
- Ninguna pantalla hace su propio `fetch`. Motivo citado: "si cada pantalla hace
  su propio `fetch`, el manejo de 'se cayó el WiFi' queda inconsistente y la
  tablet se cuelga en silencio justo cuando hay gente esperando"
  (`ARQUITECTURA §7`).
- Estado de conexión expuesto para que la tablet pueda mostrar un cartel claro de
  "sin conexión" y bloquear el envío (`PLAN §8`, fila "Se cae el WiFi").
- **No encola pedidos localmente.** Fuente: `PLAN §8`: "No encolar pedidos
  localmente en fase 1: el riesgo de pedidos duplicados o perdidos es peor que el
  de no vender 5 minutos".
- Inyección del JWT para las superficies con login; token de dispositivo para
  `/kiosk` (`PLAN §5g`).

Aceptación:
- Con el servidor apagado, una pantalla de prueba entra en estado offline
  explícito en lugar de quedar colgada.
- Los reintentos son observables y acotados.

### RQ-215 — Soporte de idempotencia en el cliente

Fuente: `ARQUITECTURA §7`, "Creación de pedido idempotente": el cliente genera un
UUID para el intento y lo manda en el `POST`.

- `apiClient` soporta enviar una clave de intento en los `POST` que lo requieran,
  y reusar la misma clave en los reintentos de ese intento.
- La contraparte en el servidor es RQ-3xx de B7 (S3). F1 construye solo el lado
  cliente, contra el mock.
- Motivo citado: "porque el WiFi se va a caer" (`ARQUITECTURA §9`, decisión 7).

Nota: `ARQUITECTURA §7` justifica la idempotencia mencionando "sufijos de
centavos distintos". Ese motivo quedó derogado (D-04); la razón vigente es
simplemente que un WiFi inestable generaría pedidos duplicados.

### RQ-216 — Hooks de WebSocket

Fuente: `ARQUITECTURA §7` (`shared/api` — "cliente HTTP + hooks de WebSocket"),
`PLAN §6` (eventos), `ARQUITECTURA §3`.

- Hooks de suscripción a los eventos de `PLAN §6`: `order.created`, `order.paid`,
  `order.status_changed`, `catalog.updated`, `qr.changed`.
- Reconexión automática.
- **El WebSocket es solo para actualizaciones incrementales.** Al conectarse o
  reconectarse, la superficie consulta primero por HTTP. Fuente:
  `ARQUITECTURA §3`: el KDS "siempre consulta `GET /kitchen/orders` al
  conectarse", y "nunca depende solo del push". El hook debe hacer que ese patrón
  sea el camino fácil, no una disciplina opcional de cada pantalla.

Aceptación:
- Cortar y restablecer la conexión no deja la pantalla con estado viejo: se
  rehidrata por HTTP.

### RQ-217 — Estructura de carpetas del frontend

Fuente: `ARQUITECTURA §7`.

```
apps/app/
├── app/          rutas de Expo Router: kiosk/, kds/, admin/
├── features/     catalog/, cart/, orders/, payments/, menu-admin/
└── shared/
    ├── ui/       Button, Card, Price — tokens
    └── api/      apiClient + hooks de WebSocket
```

Se comparte el estado, los tipos y las llamadas; cada superficie arma su propia
UI (`ARQUITECTURA §7`).

### RQ-218 — Mock de la API

Fuente: `MODULOS §3`, `docs/sprints/README.md` ("F1 arranca con la API
mockeada").

- Mock de `GET /catalog` y de los eventos de WebSocket, con la forma de los
  schemas Zod de `packages/shared` (RQ-104 de S1).
- El mock usa los tipos compartidos, no una copia: es lo que evita que el
  frontend y el backend se contradigan (`ARQUITECTURA §6`).

---

## Qué se demuestra al cerrar S2

1. La dueña crea una categoría, un plato y dos variantes desde la API.
2. Edita el precio de un plato con una sola operación y queda la fila de
   `AuditLog` correspondiente.
3. Un precio no múltiplo de 100 centavos es rechazado por la API.
4. Desactivar un plato lo saca de `GET /catalog` sin borrarlo de la base.
5. Reordenar la lista cambia el orden que devuelve `GET /catalog`.
6. Subir una foto desde un celular deja la imagen redimensionada en el
   almacenamiento y referenciada por el plato.
7. Un usuario CAJA o COCINA recibe permiso denegado del servidor al intentar
   gestionar el catálogo.
8. El frontend muestra el catálogo del mock con sus componentes propios y los
   tokens de diseño aplicados.
9. Apagando el servidor, el frontend entra en estado offline explícito en lugar
   de colgarse.

---

## Tests de este sprint

Fuente: `ARQUITECTURA §8`.

Unitarios, sin DB:
- Validación de precio: múltiplo de 100 aceptado, no múltiplo rechazado (schema
  Zod de `packages/shared`).
- Formateo de `Price` con `Money`: nunca muestra centavos.
- `apiClient`: política de reintentos, timeout y transición a estado offline,
  con el transporte mockeado.
- Reuso de la misma clave de intento entre reintentos del mismo envío.

Integración, con DB:
- Smoke test del CRUD de catálogo. Fuente: `ARQUITECTURA §8`: "No testeamos el
  CRUD de catálogo más allá de un smoke test. Es Prisma haciendo lo que Prisma
  hace".
- Un cambio de precio deja fila en `AuditLog` **en la misma transacción**: si la
  escritura del log falla, el precio tampoco cambia.
- `GET /catalog` no devuelve items inactivos.
- Guards: CAJA y COCINA rechazados en los endpoints de `/admin/categories`,
  `/admin/products` y `/admin/products/:id/variants`.

---

## Fuera de alcance en S2

- Creación de pedidos y snapshot efectivo en `OrderItem` (B7, S3). En S2 el
  snapshot es una regla documentada, no código.
- Confirmación de pagos, QR, `Refund`, `PaymentProof` (B8, S4).
- Gateway WebSocket real y namespaces por rol (B11, S4). En S2 el evento se
  emite, el transporte no existe.
- Consulta del log de auditoría `GET /admin/audit` (B10, S4).
- Pantalla de menú del panel (F5, S8) y pantallas del kiosco (F2/F3, S6). F1
  entrega componentes y capa de red, no pantallas de producto.
- Gestión de usuarios (B13, S5).
- Disponibilidad por unidades o control de stock. Fuente: `REPORTE ADM-06`: "no
  confundir: desactivar un plato es control manual de disponibilidad, no gestión
  de inventario". Queda pendiente de decisión de la dueña
  (`REPORTE §11`, pregunta 11).

---

## Riesgos

**Agregar un repositorio a `catalog` por simetría.** `ARQUITECTURA §2` lo nombra
como el error más común al adoptar vertical slices: aplicar la misma plantilla de
cuatro capas a todos los slices. `catalog` es CRUD; un repositorio que solo hace
`return prisma.product.findMany()` es ruido y se paga en cada feature posterior.
La capa se agrega cuando hay lógica que proteger, y acá no hay.

**Escribir la auditoría del cambio de precio por evento.** Es el mismo error que
`REPORTE H06` describe para los pagos, y `ARQUITECTURA §3` incluye expresamente
el cambio de precio en la excepción: va dentro de la transacción. Si se deja para
un listener, un reinicio del servidor deja un precio cambiado sin saber quién lo
cambió, y el log deja de servir para explicar un cierre que no cuadra.

**Reintroducir centavos por la ventana del catálogo.** El sufijo de centavos está
derogado (D-04), pero la validación de múltiplos de 100 es lo único que lo
sostiene en la práctica. Si alguien permite precios como Bs 45,50 "porque el
proveedor cobra así", vuelve el problema sin la mitigación que el sufijo daba, y
el formateo de toda la UI queda inconsistente.

**Resolver por cuenta propia los pendientes de `ADM-06`.** Precio cero o
negativo, baja de categorías y variantes, distinción entre desactivar y archivar,
y el efecto sobre pedidos pendientes ya creados están listados como pendientes en
`REPORTE ADM-06`. La regla de trabajo 1 de `docs/README.md` es explícita: si el
documento no lo dice, está pendiente; anotarlo y preguntar, no resolverlo
escribiendo código.

**Que cada pantalla haga su propio `fetch`.** `ARQUITECTURA §7` nombra la falla
concreta: la tablet se cuelga en silencio con gente esperando. El riesgo no es
que `apiClient` no exista, es que exista y se lo saltee una pantalla que tenía
apuro. Conviene que saltearlo sea más incómodo que usarlo.

**Diseñar componentes "universales" para kiosco y admin.** `ARQUITECTURA §7`
advierte el resultado: un componente con diez props condicionales. Lo que se
comparte son tokens, tipos, estado y llamadas; la UI de cada superficie es propia.
