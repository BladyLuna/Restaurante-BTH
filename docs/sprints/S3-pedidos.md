# S3 — Pedidos

**Módulos:** B7 `orders`
**Estimación:** 6 jornadas
**Estado:** **BLOQUEADO.** Depende de las siete políticas financieras de
`PLAN §5e`, pendientes de aprobación de la dueña (`REPORTE §16.5`,
`PLAN §10`, `docs/README.md` "Bloqueado hasta que responda la dueña").

---

## Objetivo

Que se pueda crear un pedido por HTTP y que ese pedido quede bien: número diario
consecutivo sin huecos, total calculado por el servidor, precios congelados en el
momento de la compra, y transiciones de estado que no se puedan saltear.

B7 es, junto con B8, el corazón del sistema y donde está casi todo el riesgo
técnico (`MODULOS §1`). Está en el camino crítico `B1 → B2 → B7 → B8 → F4`
(`MODULOS §3`).

---

## Qué está bloqueado y qué no

No todo B7 está detenido. La separación importa para no parar el sprint entero.

**Se puede construir sin esperar respuestas:** RQ-301 a RQ-308 y RQ-312. Son la
creación de pedidos, la numeración, la idempotencia, el cálculo de total, el
snapshot y la máquina de estados. Ninguno depende de una política financiera.

**Requiere respuesta de la dueña antes de implementarse:**

| RQ | Qué espera | Pregunta que lo desbloquea |
|---|---|---|
| RQ-309 | Regla 4 de `PLAN §5e` — pago tardío (`REPORTE H02`) | ¿Qué se hace si el cliente paga después de que el pedido venció? |
| RQ-310 | Regla 5 de `PLAN §5e` — definición de jornada y corte 05:00 | ¿A qué hora empieza la jornada y a qué jornada pertenece un pedido: la de creación o la de pago? |
| RQ-311 | Reglas 3 y 7 de `PLAN §5e` (`REPORTE H14`) | ¿Qué pasa con un plato ya pagado que cocina no puede preparar? |

Las siete políticas de `PLAN §5e` figuran como **propuestas, pendientes de
aprobación**. No se consideran acordadas hasta que ella responda
(`REPORTE §16.5`).

---

## B7 — `orders`

6 jornadas. Fuente: `PLAN §4`, `PLAN §5`, `PLAN §6`, `ARQUITECTURA §2`,
`ARQUITECTURA §7`, `MODULOS §1`, `REPORTE CLI-03`, `REPORTE SIS-01`,
`REPORTE SIS-02`, `REPORTE SIS-04`.

**Profundidad de slice: completa, con `domain/` y repositorio.** Fuente:
`ARQUITECTURA §2`, tabla de profundidad variable: `orders` y `payments` tienen
reglas reales —transiciones válidas, numeración transaccional, cálculo de
totales— y justifican las capas. Es lo contrario de `catalog` (S2).

Estructura, de `ARQUITECTURA §2`:

```
orders/
├── orders.controller.ts      HTTP
├── orders.service.ts         orquestación, transacciones
├── orders.repository.ts      acceso a datos
├── domain/
│   ├── order-state.ts        máquina de estados (función pura)
│   └── order-total.ts        cálculo de total (función pura)
├── dto/
└── orders.module.ts
```

### RQ-301 — Creación de pedido

Fuente: `PLAN §5` (pasos 1 y 2), `PLAN §6` (`POST /orders`),
`REPORTE CLI-03`.

- `POST /orders` recibe los items (producto, variante opcional, cantidad, notas),
  el nombre del cliente y el tipo (comer aquí / para llevar).
- Devuelve el número de pedido y el total (`PLAN §6`).
- El pedido nace en `PENDIENTE_PAGO` (`PLAN §5`, paso 2).
- Endpoint público, sin login de usuario: el kiosco usa token de dispositivo
  (`PLAN §6` sección pública, `PLAN §5g` Dispositivos).
- CAJA y ADMIN también pueden crear pedidos (`PLAN §5g`, fila "Crear pedido":
  Sí para KIOSCO, CAJA y ADMIN; No para COCINA).
- Validación con los schemas Zod de `packages/shared` (`PLAN §6`, RQ-104 de S1).
- Todo escrito con filtro de contexto de local (`ARQUITECTURA §1`, RQ-115 de S1).

Nombre del cliente: `PLAN §7` dice que es el único campo de texto de todo el
flujo y que "es opcionalmente salteable (queda solo el número)".
**Pendiente de decisión:** `REPORTE §11` pregunta 9 pregunta si el nombre es
obligatorio. Importa más de lo que parece, porque el nombre es la única señal de
desambiguación que queda (R-01, RQ-4xx de S4). Hasta que se responda, se
implementa como opcional según `PLAN §7` y se registra la consecuencia: un pedido
sin nombre no puede desambiguarse por nombre.

Aceptación:
- El pedido queda en `PENDIENTE_PAGO` con número, items y total.
- Un `POST` con un plato inactivo es rechazado como resultado de dominio, no como
  excepción (`ARQUITECTURA §5`, Result: "plato inactivo" es un resultado
  esperable).

### RQ-302 — Numeración transaccional

Fuente: `PLAN §4` ("Numeración diaria"), RQ-108 de S1 (tabla `OrderCounter`),
`MODULOS §0`, `ARQUITECTURA §1`, `REPORTE SIS-02`.

- `OrderCounter` con una fila por día y un `SELECT ... FOR UPDATE` **dentro de la
  transacción que crea el pedido** (`PLAN §4`).
- Garantiza números consecutivos **sin huecos ni duplicados** (`PLAN §4`).
- **Único por `(fecha, locationId)`, no global.** Fuente: `ARQUITECTURA §1`,
  "El número de pedido es único por día y por local"; `MODULOS §0`. Hoy hay un
  local, pero la clave compuesta ya existe.
- El número visible (`#42`) no es la identidad global del pedido. Fuente:
  `REPORTE SIS-02`, propuesta: "no usar solo el número visible como identidad
  global". Las operaciones de la API usan el `id`.

Pendiente técnico, no de negocio: `REPORTE SIS-02` lista como pendiente la
"creación concurrente de la primera fila del contador". Dos pedidos simultáneos
al abrir la jornada no deben duplicar la fila de `OrderCounter`. Hay que
resolverlo en la implementación, y está cubierto por el test de concurrencia de
`ARQUITECTURA §8`.

Aceptación:
- Dos creaciones simultáneas nunca comparten número (`ARQUITECTURA §8`, test de
  integración de numeración concurrente).

### RQ-303 — Idempotencia por UUID de intento

Fuente: `ARQUITECTURA §7` ("Creación de pedido idempotente"),
`ARQUITECTURA §8` (test "el mismo UUID dos veces crea un solo pedido"),
`ARQUITECTURA §9` decisión 7, `MODULOS §1` (B7 incluye "idempotencia por UUID"),
`REPORTE SIS-05`.

- El cliente genera un UUID para el intento y lo manda en el `POST`
  (`ARQUITECTURA §7`). El lado cliente es RQ-215 de S2.
- Si la respuesta se pierde por WiFi y la tablet reintenta, el servidor
  **reconoce el UUID y devuelve el pedido ya creado** en lugar de crear un
  segundo (`ARQUITECTURA §7`).
- Motivo citado: "porque el WiFi se va a caer" (`ARQUITECTURA §9`, decisión 7).
  `PLAN §8` lo confirma como riesgo operativo de primer orden.
- La clave de idempotencia se guarda de forma que la unicidad la imponga la base,
  no una comprobación previa en código. Con dos peticiones simultáneas con el
  mismo UUID, una gana y la otra devuelve el mismo pedido.

Nota: `ARQUITECTURA §7` justifica este requerimiento agregando que los duplicados
tendrían "sufijos de centavos distintos, lo que rompe el cuadre de caja". Ese
motivo quedó derogado (D-04). La razón vigente se sostiene sola: un WiFi
inestable genera pedidos duplicados, y un pedido duplicado es comida que sale sin
cobrar o un cliente cobrado dos veces.

**No se encola nada en el cliente.** Fuente: `PLAN §8`: "No encolar pedidos
localmente en fase 1: el riesgo de pedidos duplicados o perdidos es peor que el
de no vender 5 minutos". La idempotencia cubre el reintento inmediato, no la
operación offline.

Aceptación:
- El mismo UUID enviado dos veces produce un solo pedido y dos respuestas
  idénticas.

### RQ-304 — Recálculo de total siempre en el servidor

Fuente: `PLAN §6` ("Validación": "El total **se recalcula siempre en el
servidor** desde los precios de la base — nunca se confía en el total que manda
la tablet"), `ARQUITECTURA §6`, `docs/README.md` regla de trabajo 3,
`REPORTE SIS-01`.

- El total se calcula en el servidor a partir de los precios vigentes en la base
  al momento de crear el pedido.
- El total que manda el cliente se **ignora**, no se compara ni se valida contra
  el propio. El cliente usa `Money` para mostrar, nunca para decidir
  (`ARQUITECTURA §6`).
- El cálculo vive en `domain/order-total.ts` como **función pura**
  (`ARQUITECTURA §2`), testeable sin base de datos (`ARQUITECTURA §8`: "Cálculo
  de total con variantes y cantidades").
- Precio unitario: `ProductVariant.precio` si hay variante, `Product.precioBase`
  si no (`PLAN §4`, "Variantes opcionales").
- Todo en centavos enteros con el value object `Money` (RQ-101 de S1), múltiplos
  de 100 (D-04).

**`total` iguala a `subtotal`.** Fuente: `PLAN §4`: "`total` iguala a `subtotal`;
se mantienen los dos campos para que el cierre pueda distinguir la venta del
ajuste si alguna vez vuelve a haber uno". `REPORTE §16.4`. No hay sufijo de
centavos: la fórmula `total = subtotal + sufijo` de `REPORTE SIS-01` quedó
derogada por D-04.

**No hay pool de sufijos.** Fuente: D-04, `REPORTE §16.8` ("Sale del alcance:
pool de sufijos de centavos en `B8`"), `docs/sprints/README.md`. `REPORTE SIS-03`
describe el pool 00–99 y su liberación: esa sección entera está derogada. Si
aparece lógica de sufijos en B7 o B8, es que se copió de una versión vieja.

Aceptación:
- Un `POST` que manda un total menor al real crea el pedido con el total
  correcto del servidor.
- El cálculo con variantes y cantidades múltiples es exacto en centavos.

### RQ-305 — Snapshot de nombre y precio en `OrderItem`

Fuente: `PLAN §4` ("Snapshot de precios", `OrderItem` con `nombreSnapshot` y
`precioUnitarioSnapshot`), `ARQUITECTURA §5` (patrón Snapshot),
`REPORTE ADM-06`, RQ-208 de S2.

- Al crear el `OrderItem` se copian `nombreSnapshot` y
  `precioUnitarioSnapshot` del plato o la variante.
- Motivo citado: "Si la dueña cambia el precio de un plato a mitad del día, los
  pedidos ya hechos no se alteran. Sin esto, el reporte de ventas y los totales
  históricos se corrompen cada vez que toca un precio" (`PLAN §4`).
- `orders` consulta `catalog` directamente para armar el pedido. Eso está
  permitido: es "una dependencia real del dominio, no acoplamiento accidental"
  (`ARQUITECTURA §2`, excepción pragmática).
- `REPORTE ADM-06`: un pedido ya creado conserva el precio histórico.

Aceptación:
- Cambiar el precio de un plato después de crear un pedido no modifica el total
  ni el nombre guardado de ese pedido.

### RQ-306 — Máquina de estados usando la tabla de B1

Fuente: `ARQUITECTURA §4` (SRP), `PLAN §5`, RQ-102 de S1,
`REPORTE §9`.

- Toda transición pasa por la **única función pura** de `packages/shared`
  (RQ-102 de S1). Está prohibido escribir `if (order.estado === 'PAGADO')`
  disperso en controllers (`ARQUITECTURA §4`).
- La tabla vigente, de `ARQUITECTURA §4` y RQ-102:

```
PENDIENTE_PAGO:  ['PAGADO', 'CANCELADO']
PAGADO:          ['EN_PREPARACION', 'CANCELADO']
EN_PREPARACION:  ['LISTO']
LISTO:           ['ENTREGADO']
ENTREGADO:       []
CANCELADO:       []
```

- `ENTREGADO` y `CANCELADO` son terminales. Fuente: `REPORTE §9`: "No hay
  devolución, reapertura, preparación parcial ni cancelación desde
  EN_PREPARACION/LISTO. Si el negocio necesita esos casos, deben diseñarse, no
  forzarse mediante cambios manuales en la base".
- La transición inválida devuelve un `Result` de error de dominio, no una
  excepción (`ARQUITECTURA §5`, RQ-103 de S1).
- La transición a `PAGADO` **no se implementa en B7**: es `B8 payments` (S4),
  porque arrastra la confirmación, la desambiguación y la auditoría en la misma
  transacción (D-07). B7 expone la validación de transición; B8 la usa.

**Lo que nunca puede pasar:** que un pedido en `PENDIENTE_PAGO` llegue a cocina.
Fuente: `docs/README.md` ("es el punto de todo el diseño"), `PLAN §8` ("El estado
`PENDIENTE_PAGO` nunca llega a cocina"), `REPORTE COC-01`.

Aceptación:
- Toda transición que no esté en la tabla es rechazada por el servidor.
- Un intento de pasar de `PENDIENTE_PAGO` a `EN_PREPARACION` es rechazado.

### RQ-307 — Consulta de estado del pedido

Fuente: `PLAN §6` (`GET /orders/:id` — estado del pedido, para la pantalla de
espera), `REPORTE CLI-05`.

- Devuelve el estado y el número, para la pantalla de espera del kiosco.
- Endpoint de la sección pública de `PLAN §6`.

Pendiente de decisión: `REPORTE SIS-07` deja abierta la "autorización de lectura
individual de pedidos" y el "alcance del token de kiosco". Cualquiera con el `id`
podría consultarlo. Hasta que se defina, no se expone en esta respuesta ningún
dato que no esté ya en la pantalla pública de listos.

### RQ-308 — Evento `order.created` después del commit

Fuente: `PLAN §6` (lista de eventos WebSocket), `ARQUITECTURA §3`.

- Se emite `order.created` **después del commit**, nunca dentro de la
  transacción. Fuente: `ARQUITECTURA §3`: "Si emitís adentro y la transacción
  después falla, la cocina ya recibió un pedido que en la base no existe. Al
  revés es recuperable".
- Un `EventEmitter` en proceso después del commit es suficiente: es un servidor
  único en una LAN. **No** hace falta un outbox transaccional con cola
  (`ARQUITECTURA §3`).
- El gateway WebSocket es `B11` (S4). En S3 se emite el evento de dominio; el
  transporte se conecta en S4.
- El pedido recién creado está en `PENDIENTE_PAGO` y **no es trabajo preparable**.
  A cocina solo puede llegar, como máximo, un contador informativo de pendientes
  de pago (`REPORTE COC-01`, `PLAN §5b` "La dueña es el cuello de botella").

### RQ-309 — Job de cancelación por timeout de 15 minutos

Fuente: `PLAN §5b` ("Carritos abandonados"), `MODULOS §1`,
`REPORTE SIS-04`, RQ-109 de S1 (el timeout vive en tabla `Setting`).

- Un job cancela las órdenes en `PENDIENTE_PAGO` después de 15 minutos
  (configurable) (`PLAN §5b`).
- El valor configurable sale de `Setting`, no de `.env` (`ARQUITECTURA §1`,
  RQ-109 de S1).
- **No libera ningún sufijo.** `PLAN §5b` dice "libera el sufijo de centavos al
  pool"; eso quedó derogado por D-04. El job solo cancela.
- Cancela **solo si el pedido continúa pendiente al ejecutar la operación**, y la
  carrera contra una confirmación humana se resuelve dentro de la transacción.
  Fuente: `REPORTE SIS-04`, propuesta.
- Conserva el motivo de expiración en `canceladoMotivo` (`PLAN §4`,
  `REPORTE SIS-04`).
- La cancelación por expiración escribe `AuditLog` dentro de la misma transacción
  (`ARQUITECTURA §3`: la excepción de auditoría financiera incluye las
  cancelaciones; D-07).

Aceptación:
- Un pedido pendiente de más de 15 minutos queda `CANCELADO` con motivo de
  expiración.
- Un pedido que fue confirmado en el instante en que corría el job no se cancela:
  o se confirma o se cancela, nunca las dos cosas.

**Pendiente de decisión — bloquea la parte de pago tardío.**
`REPORTE H02` [crítico] y `REPORTE §16.9`: el pago tardío **no está resuelto y se
agravó** con D-04, "porque ya no hay sufijo que liberar ni reutilizar como
señal". La ventana de 15 minutos no impide que el banco procese o que una persona
pague más tarde (`REPORTE H02`). `REPORTE SIS-04` también lo deja abierto: "qué
pasa si la dueña se retrasa aunque el cliente ya pagó".

La regla 4 propuesta en `PLAN §5e` es: "el pedido no se revive. Se crea uno nuevo
o queda como `Refund` pendiente". **No está aprobada** (`REPORTE §16.5`).

Pregunta que lo desbloquea: ¿qué se hace cuando el cliente pagó pero el pedido ya
venció — se crea un pedido nuevo con el mismo dinero, o se le devuelve?
Sin esa respuesta no se implementa ningún camino de revivir, extender o reabrir
un pedido vencido. El job de expiración sí se implementa; lo que queda detenido
es el tratamiento del abono que llega después.

### RQ-310 — Fecha de jornada del pedido

Fuente: `PLAN §4` ("se reinicia en `#1` cada día a una hora configurable, ej.
05:00"), RQ-108 de S1, `REPORTE SIS-02`.

- El pedido guarda la `fecha` de jornada, no solo el timestamp de creación
  (`PLAN §4`, `REPORTE SIS-02`: "conservar fecha de jornada y contexto del local
  con el pedido").
- La hora de corte sale de `Setting` (RQ-109 de S1).

**Pendiente de decisión.** La regla 5 propuesta de `PLAN §5e` dice: corte a las
05:00, y "un pedido pertenece a la jornada en que fue **pagado**, no en que fue
creado". No está aprobada (`REPORTE §16.5`). Esto choca con la numeración, que
necesita una fecha **en el momento de la creación**, cuando todavía no hay pago.

`REPORTE SIS-02` lista como pendientes la "zona horaria explícita", la
"definición de jornada" y el "cambio del horario de corte".
`REPORTE ADM-08` pregunta "qué fecha define el cierre (creación/pago/jornada)".

Preguntas que lo desbloquean: ¿la hora de corte es 05:00? ¿Un pedido creado a las
04:50 y pagado a las 05:10 pertenece a qué jornada? Mientras no haya respuesta,
B7 guarda la fecha de jornada de **creación** para numerar, y **no** se
implementa ninguna reasignación de jornada al pagar: eso es `B12 reports` (S9)
y depende de la misma respuesta.

### RQ-311 — Plato pagado que cocina no puede preparar

Fuente: `REPORTE H14` [alto], `REPORTE COC-05`, `REPORTE §16.9`,
`PLAN §10` ("Decisiones de UI todavía abiertas"), `docs/README.md` (pendientes
técnicos).

**Pendiente de decisión. No se implementa en S3.**

Estado documentado: `REPORTE COC-05` dice textualmente "pendiente; no existe caso
resuelto en el plan". La regla 7 propuesta de `PLAN §5e` lo cubre en lo operativo
—"cocina avisa; se ofrece sustitución de igual precio o devolución según la regla
3"— pero `REPORTE §16.9` aclara que "falta el flujo en el sistema", y la regla
tampoco está aprobada.

Lo que **no** se debe hacer, citado: "No inventar una acción de cancelación de
cocina: no aparece entre sus permisos documentados" (`REPORTE COC-05`). La matriz
de `PLAN §5g` confirma que COCINA no cancela y que cancelar un pedido pagado es
solo ADMIN.

Preguntas que lo desbloquean: ¿quién avisa al cliente? ¿se sustituye por un plato
de igual precio, se cancela, o se devuelve el dinero? ¿Cómo se registra la
sustitución, si el `OrderItem` tiene el precio congelado por snapshot?

Lo único que S3 deja preparado: la tabla de transiciones permite
`PAGADO → CANCELADO`, y la cancelación de un pedido pagado genera un `Refund`
pendiente (D-09). Eso se implementa en B8 (S4), no acá.

### RQ-312 — Dominio puro separado de la orquestación

Fuente: `ARQUITECTURA §2` (estructura del slice), `ARQUITECTURA §8`,
`ARQUITECTURA §9` decisión 3.

- `domain/order-state.ts` y `domain/order-total.ts` son funciones puras, sin
  Prisma ni Nest, testeables sin base de datos.
- `orders.service.ts` orquesta y maneja la transacción.
- Motivo citado: "El dominio puro es testeable sin base de datos, y ahí está casi
  todo el riesgo del sistema" (`ARQUITECTURA §8`).

---

## Qué se demuestra al cerrar S3

1. `POST /orders` crea un pedido en `PENDIENTE_PAGO` y devuelve número y total.
2. Dos creaciones simultáneas obtienen números distintos y consecutivos, sin
   huecos.
3. El mismo UUID de intento enviado dos veces produce un solo pedido.
4. Un `POST` que manda un total falso se guarda con el total correcto del
   servidor.
5. Cambiar el precio de un plato no altera el total de un pedido ya creado.
6. Un intento de pasar de `PENDIENTE_PAGO` a `EN_PREPARACION` es rechazado por el
   servidor.
7. Un pedido con más de 15 minutos en `PENDIENTE_PAGO` queda `CANCELADO` con
   motivo de expiración y fila en `AuditLog`.
8. Un pedido que incluye un plato inactivo es rechazado con un error de dominio
   legible, no con un error 500.
9. El total de un pedido con variantes y cantidades múltiples es exacto en
   centavos y múltiplo de 100.

Lo que **no** se puede demostrar al cerrar S3: pasar un pedido a `PAGADO`. Esa
transición es B8 (S4) porque arrastra la autoría, la desambiguación y la
auditoría en la misma transacción.

---

## Tests de este sprint

Fuente: `ARQUITECTURA §8`.

Unitarios, sin DB:
- Cálculo de total con variantes y cantidades (`ARQUITECTURA §8`, lista
  explícita).
- Tabla de transiciones: toda transición inválida es rechazada
  (`ARQUITECTURA §8`). Se reusa el test de RQ-102 de S1 aplicado al servicio.
- `PENDIENTE_PAGO` nunca transiciona a `EN_PREPARACION` ni a `LISTO`.
- `total = subtotal` y el resultado siempre es múltiplo de 100.
- Pedido con items de cantidad cero o negativa rechazado por el schema Zod.

Integración, con DB:
- Numeración concurrente: dos pedidos simultáneos nunca comparten número
  (`SELECT ... FOR UPDATE`) (`ARQUITECTURA §8`, lista explícita).
- Idempotencia: el mismo UUID dos veces crea un solo pedido
  (`ARQUITECTURA §8`, lista explícita).
- Creación concurrente de la primera fila de `OrderCounter` del día no duplica la
  fila (`REPORTE SIS-02`, pendiente).
- Carrera entre el job de expiración y una confirmación: el pedido termina en un
  solo estado, nunca en los dos caminos (`REPORTE SIS-04`).
- El job de expiración deja `canceladoMotivo` y fila de `AuditLog` en la misma
  transacción.
- Snapshot: cambiar el precio del plato después de crear el pedido no modifica el
  `OrderItem`.
- Un pedido creado con un plato inactivo es rechazado.

Fuente de la exclusión: `ARQUITECTURA §8`, "No testeamos el CRUD de catálogo más
allá de un smoke test".

---

## Fuera de alcance en S3

- Transición a `PAGADO`, confirmación de pago, desambiguación de montos iguales
  (B8, S4).
- CRUD de QR, `Refund`, `PaymentProof` (B8, S4).
- Gateway WebSocket y namespaces por rol (B11, S4). En S3 el evento se emite en
  proceso.
- Consulta del log de auditoría (B10, S4).
- Cola de cocina y avance de estados (B9, S8).
- Cualquier pantalla. El kiosco es F2/F3 (S6).
- Reasignación de jornada al pagar y cuadre de cierre (B12, S9), que además
  dependen de la misma respuesta pendiente que RQ-310.
- Pool de sufijos de centavos: **derogado** (D-04, `REPORTE §16.8`). No está
  "para después", no existe.
- Encolado offline de pedidos en el cliente (`PLAN §8`, decisión explícita de no
  hacerlo en fase 1).

---

## Riesgos

**Dejar la idempotencia para después.** `MODULOS §2` la nombra entre lo que
**no** se puede recortar, junto con la auditoría y los backups, porque son los
que generan pérdida de dinero o de datos si faltan. Es además la clase de
requerimiento que parece opcional en el escritorio del desarrollador, donde el
WiFi funciona, y que aparece el primer día de uso real en el local.

**Confiar en el total que manda la tablet.** La tentación es comparar el total
del cliente con el del servidor y devolver un error si no coinciden, lo que
parece más prolijo. Es peor: convierte un dato no confiable en parte de la
decisión. `PLAN §6` y `ARQUITECTURA §6` son explícitos: el cliente muestra, el
servidor decide. El total del cliente se ignora.

**Implementar el pago tardío por intuición.** `REPORTE H02` está marcado como
crítico y no resuelto, y `REPORTE §16.9` dice que D-04 lo agravó. La salida fácil
—"si llega un pago de un pedido vencido, lo revivo"— crea un camino de reapertura
que la tabla de estados no tiene (`REPORTE §9`: `CANCELADO` es terminal) y abre
un vector nuevo: un abono viejo reclamado contra un pedido nuevo del mismo monto,
que es exactamente R-01. Hasta que la dueña responda, no se escribe ese camino.

**Numerar fuera de la transacción.** Si el número se obtiene antes de abrir la
transacción, o con un `SELECT` sin `FOR UPDATE`, dos pedidos simultáneos
comparten número. El síntoma aparece recién con dos clientes al mismo tiempo, que
es exactamente la hora del almuerzo. El test de concurrencia de
`ARQUITECTURA §8` no es opcional.

**Dispersar la máquina de estados.** `ARQUITECTURA §4` nombra la falla: un
`if (order.estado === 'PAGADO')` en el controller de cocina, otro en el de admin,
otro en el kiosco, y después se agrega un estado y hay que encontrar los siete
lugares. B7 es donde esa dispersión empieza, porque es el primer módulo que
transiciona algo.

**Copiar lógica de sufijos de una versión vieja.** `PLAN §5b` todavía contiene el
texto del pool y `REPORTE SIS-03` lo describe completo, ambos marcados como
derogados. `PLAN §5b` incluso dice que el job "libera el sufijo al pool". Si se
implementa de memoria o leyendo esas secciones sin ver la derogación, entra al
código una regla que D-04 eliminó.

**Que el pedido pendiente llegue a cocina.** Es la única falla del sistema que no
admite matices: `docs/README.md` la llama "el punto de todo el diseño" y
`PLAN §8` la lista como riesgo operativo. El evento `order.created` se emite para
el panel de cobro, y a cocina solo le corresponde un contador informativo de
pendientes (`REPORTE COC-01`). Un listener mal suscrito en S4 es suficiente para
romperlo.
