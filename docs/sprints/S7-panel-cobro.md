# S7 — Panel de cobro

**Módulos:** F4 `admin — pagos` (5 j), F6 `admin — cobro` (3 j)
**Estimación:** 8 jornadas
**Estado:** Bloqueado. Depende de `B8 payments` (S4) y de las políticas
financieras de `PLAN §5e`, que están propuestas y pendientes de aprobación de la
dueña.

---

## Objetivo

Construir la pantalla crítica del sistema: la que una persona del local usa para
convertir un abono que vio en el banco en un pedido confirmado, y la que gestiona
los QR con los que se cobra.

Al cerrar S7 el ciclo se cierra por primera vez: un pedido hecho en la tablet
pasa a `PAGADO` porque alguien vio la plata en la app bancaria.

---

## Nota sobre quién usa este panel

El panel de cobro lo usan **dos roles**: ADMIN (la dueña) y CAJA (`PLAN §5g`,
D-02). `PLAN §7` lo titula "panel de la dueña" por historia del documento, pero
desde D-02 eso ya no es exacto y no debe escribirse así en el código ni en la UI.

Lo que cambia según el rol (`PLAN §5g`, `REPORTE §16.2`):

| Acción | CAJA | ADMIN |
|---|---|---|
| Confirmar pago de monto coincidente | Sí | Sí |
| Confirmar con diferencia de monto | **No** | Sí |
| Cancelar pedido pagado | **No** | Sí |
| Marcar ENTREGADO | Sí | Sí |
| Adjuntar comprobante de conflicto | Sí | Sí |
| Gestionar QR de cobro (F6) | **No** | Sí |
| Ver cuadre del día | **No** | Sí |

**La autorización se valida en el servidor** (`PLAN §5g`). Ocultar un botón no es
un permiso. Lo de abajo describe qué ve cada rol; el guard de B3 es lo que
decide.

---

## F4 — `admin — pagos`

5 jornadas. Fuente: `PLAN §5b` (el panel de confirmación), `PLAN §7` (pestaña 1),
`PLAN §5g` (cómo verifica CAJA), `REPORTE ADM-02`, `ADM-03`, `ADM-04`,
`REPORTE §16.3`, `REPORTE §16.4`, D-02, D-03, D-04, D-07, R-01.

La regla que sostiene todo (`PLAN §5b`, `docs/README.md`):

> Un pago se confirma porque se vio el abono en la app bancaria. Nunca porque el
> cliente lo diga, nunca porque muestre una captura.

Todo el diseño de esta pantalla existe para empujar a ese hábito. `PLAN §5b` es
explícito sobre el modo en que falla: *"si el panel es una lista de pedidos con
botones verdes, los va a tocar con la fila de gente mirándola"*. Por eso el flujo
va **del pago al pedido, no del pedido al pago**.

### RQ-701 — Buscador por monto con foco automático

Fuente: `PLAN §5b` ("el panel de confirmación"), `PLAN §7` (pestaña 1),
`REPORTE ADM-02`.

- El campo de búsqueda por monto **tiene el foco por defecto** al abrir la
  pantalla. Es la primera cosa que recibe una tecla.
- El operador ve el abono en el celular del negocio (D-03), tipea el monto, y el
  pedido aparece.
- La etiqueta es una pregunta, no un sustantivo: **"¿Cuánto recibiste?"**
  (`PLAN §5b`). No "buscar pedido".
- El monto es un **boliviano entero** (D-04). Nada de campo de centavos ni
  máscara con decimales.

Pendiente de decisión (`REPORTE ADM-02`): si la búsqueda es por monto completo o
por los últimos dígitos. `PLAN §5b` menciona las dos cosas en párrafos distintos
("tipea los últimos dos dígitos" venía del esquema de sufijos derogado por D-04).
Con montos enteros, el monto completo es lo que el operador tiene a la vista en el
extracto. Pregunta que lo desbloquea: ¿qué ve exactamente en el listado de
movimientos de su banco, el monto completo o truncado?

Aceptación: al cargar la pantalla, escribir un número sin tocar nada escribe en el
campo de monto.

### RQ-702 — Resultado de la búsqueda con contexto suficiente para contrastar

Fuente: `PLAN §5b`, `REPORTE ADM-02`.

Cada coincidencia muestra:

- Número de pedido (`#42`)
- Nombre del cliente
- Cantidad de items
- Antigüedad ("hace 3 min")
- Monto
- QR / cuenta a la que se le dijo pagar (`paymentQrId`, `REPORTE ADM-02`)

El nombre del cliente es **señal blanda** (`PLAN §5b`, R-01): la app bancaria
muestra el nombre del remitente, pero pagar desde la cuenta de un familiar es
común, así que una diferencia de nombre **no bloquea, solo se muestra**. No se
implementa ninguna validación automática de nombre contra el remitente.

### RQ-703 — Desambiguación obligatoria con montos iguales

Fuente: `REPORTE §16.4` (requisito nuevo para `B8`/`F4`), `PLAN §5b`
(derogación), D-04, R-01.

Es el **único control estructural** que queda contra la confusión de pagos tras
derogar el sufijo de centavos.

- Cuando existan **dos o más pedidos abiertos con el mismo total**, el panel los
  marca como **ambiguos**.
- Con pedidos ambiguos, la confirmación **está bloqueada** hasta que el operador
  elige explícitamente uno por nombre.
- La elección es un paso propio, no un acierto de orden de lista: no se puede
  confirmar "el primero" por reflejo.
- La desambiguación queda registrada en `AuditLog` junto con la confirmación, de
  modo que el cierre pueda explicar por qué se eligió ese pedido y no el otro.

El lado servidor (detección de ambigüedad y rechazo de confirmación sin
desambiguar) es B8, estimado en 1 jornada en `REPORTE §16.8`. Acá va la UI del
paso y el bloqueo.

Aceptación:
- Con dos pedidos abiertos de Bs 45, buscar 45 devuelve ambos marcados como
  ambiguos y ningún botón de confirmar directo.
- Elegir uno por nombre habilita la confirmación solo para ese.
- El servidor rechaza una confirmación de pedido ambiguo que no traiga la
  desambiguación, aunque la UI la haya mostrado.

### RQ-704 — Cola de pendientes para conciencia de situación

Fuente: `PLAN §5b`, `PLAN §7` (pestaña 1).

Debajo del buscador, la cola de pedidos esperando pago: número, nombre, monto y
antigüedad, con el contador de cuántos son ("Esperando pago (4)").

Su función es **conciencia de situación**, no ser el camino principal de
confirmación. El camino principal es RQ-701: del pago al pedido.

### RQ-705 — Confirmar desde la cola pasa por un diálogo, nunca por un botón verde suelto

Fuente: `PLAN §5b`.

Cada fila de la cola **se puede** confirmar directo, porque a veces el operador ya
tiene el abono identificado. Pero ese camino:

- Abre un **diálogo** que muestra el **monto en grande**.
- Pregunta literalmente: **"¿recibiste Bs 45 de este pedido?"**.
- Exige una acción deliberada para aceptar.

Lo que está prohibido por diseño: un botón verde suelto en la fila que se toca por
reflejo con la fila de gente mirando (`PLAN §5b`). La fricción es el control.

Aceptación: no existe en el panel ningún control que cambie un pedido a `PAGADO`
con un solo toque y sin diálogo intermedio.

### RQ-706 — Confirmación de monto coincidente

Fuente: `PLAN §6` (`POST /admin/orders/:id/confirm-payment`), `PLAN §5g`,
`REPORTE ADM-03`, D-02, D-07.

- Disponible para **CAJA y ADMIN**.
- Transición `PENDIENTE_PAGO → PAGADO`.
- `Order.confirmadoPorId` persiste el usuario autenticado que confirmó, **no el de
  la dueña** (`REPORTE §16.3`, paso 5; `REPORTE V23`).
- `AuditLog` se escribe **dentro de la misma transacción** que el cambio de estado
  (D-07, `ARQUITECTURA §3`), con quién, cuándo, monto esperado y monto recibido
  (`PLAN §5c`).
- La confirmación es **idempotente**: confirmar dos veces no produce dos
  transiciones ni dos filas de auditoría financiera efectivas
  (`REPORTE ADM-03`, `V06`, `V27`).
- No se puede confirmar un pedido ya cancelado por vencimiento
  (`REPORTE V07`).

El servidor es B8. Acá va la UI, el manejo del resultado y el feedback.

Aceptación: dos operadores confirmando el mismo pedido a la vez producen una sola
confirmación efectiva y un solo registro financiero.

### RQ-707 — Confirmar con diferencia — solo ADMIN

Fuente: `PLAN §5b` ("falla real a cubrir", defensa 2), `PLAN §5g`, `PLAN §6`
(`POST /admin/orders/:id/confirm-with-difference`), `REPORTE ADM-04`, D-02.

- Se ingresa el **monto realmente recibido**, el sistema lo compara con el
  esperado, y si no coincide registra la discrepancia en el log y pide
  **confirmación explícita**.
- **No se bloquea la venta — se deja rastro** (`PLAN §5b`).
- **Reservado a ADMIN.** CAJA no resuelve diferencias (D-02, `PLAN §5g`).
- Para CAJA este camino **no existe en la UI** y además el servidor lo rechaza
  (`REPORTE V25`).
- El registro distingue monto esperado, monto recibido y la diferencia. **No se
  alteran los precios históricos para ocultar el descuadre**
  (`REPORTE ADM-04`, propuesta adoptada en `PLAN §5c`).

Pendiente de aprobación de la dueña (`PLAN §5e`, reglas 1 y 2, estado
"propuestas"): la tolerancia concreta. La propuesta es diferencia de hasta Bs 2
confirmable por CAJA y más de Bs 2 solo por ADMIN. **Mientras no esté aprobada, se
implementa la versión restrictiva**: cualquier diferencia es ADMIN. Pregunta que
lo desbloquea: ¿acepta que una cajera confirme un pago que entró Bs 2 por debajo,
o quiere que cualquier diferencia pase por usted?

Aceptación: CAJA no puede alcanzar este endpoint ni con la UI modificada.

### RQ-708 — Derivación a ADMIN

Fuente: `PLAN §5g` ("monto no coincidente o pedido ausente del extracto → deriva
a ADMIN"), `REPORTE §16.3`.

Cuando CAJA no puede resolver (monto distinto, pedido que no aparece en el
extracto), el panel le ofrece un camino de **derivar**, no un camino de forzar.

Pendiente de decisión: cómo se materializa la derivación. No está documentado si
es una marca en el pedido, un aviso en el panel de ADMIN, o algo fuera del sistema
(decirle a la dueña). `docs/README.md` regla 1: si el documento no lo dice, está
pendiente. Pregunta que lo desbloquea: cuando la cajera encuentra un pago que no
cuadra, ¿quiere verlo marcado en su panel, o prefiere que la llame?

### RQ-709 — Comprobante de conflicto

Fuente: `PLAN §5f`, `REPORTE §16.6`, D-05, R-03, `PLAN §6`
(`POST /admin/orders/:id/proof`).

- La carga la inicia **CAJA o ADMIN desde el panel**, fotografiando la pantalla
  del cliente. Nunca el cliente desde su teléfono (`PLAN §5f`, descartado por
  arquitectura).
- Se guarda como `PaymentProof` atado al pedido, con `subidoPorId`.
- Es **evidencia para una reclamación posterior, no autorización**. Subir un
  comprobante **no habilita** la confirmación ni cambia el estado del pedido
  (D-05, R-03).
- Por eso el botón de subir comprobante **no vive al lado del de confirmar**: no
  es un paso del flujo de cobro, es una acción de excepción.

Pendiente de decisión (`PLAN §5f`, `REPORTE §16.6`): período de retención de esas
imágenes, porque son datos de terceros. Pregunta que lo desbloquea: ¿cuánto tiempo
se guardan las fotos de comprobantes antes de borrarlas?

### RQ-710 — Panel ruidoso

Fuente: `PLAN §5b` ("la dueña es el cuello de botella"), `PLAN §8`.

Si quien confirma está ocupado, la cocina no recibe nada. El panel necesita ser
ruidoso:

- **Sonido** al entrar un pedido nuevo en `PENDIENTE_PAGO`.
- **Contador grande** de pendientes.
- **Badge en el título de la pestaña** del navegador.

El aviso correspondiente en el KDS ("N pedidos esperando pago") es RQ-8xx en S8.

### RQ-711 — Tiempo en cola y expiración visible

Fuente: `PLAN §5b` (carritos abandonados, 15 min configurable), `PLAN §5e` regla
4, `REPORTE CLI-04` (pendiente: expiración visible), `REPORTE SIS-04`.

- Cada pedido de la cola muestra su antigüedad.
- Un pedido cerca de expirar se destaca, porque confirmarlo justo cuando el job
  lo cancela es la carrera de `REPORTE V07`.

Pendiente de aprobación de la dueña (`PLAN §5e` regla 4, propuesta): qué pasa con
un pago que llega después de la expiración. La propuesta es que el pedido no se
revive y se crea uno nuevo o queda como `Refund` pendiente. `REPORTE H02` sigue
abierto y **agravado** por D-04, porque ya no hay sufijo que liberar ni reutilizar
como señal. Pregunta que lo desbloquea: si el cliente paga a los 20 minutos,
¿rehacemos el pedido o le devolvemos la plata?

### RQ-712 — Actualización en vivo de la cola

Fuente: `PLAN §6` (eventos `order.created`, `order.paid`,
`order.status_changed`), `ARQUITECTURA §3`.

La cola se actualiza por WebSocket sin recargar. Igual que el KDS
(`ARQUITECTURA §3`), el panel **reconstruye por HTTP al conectarse**
(`GET /admin/orders?estado=`) y usa el WebSocket solo para incrementales. Nunca
depende solo del push.

Aceptación: reiniciar el servidor con el panel abierto no deja la cola
desactualizada en silencio; al reconectar se reconstruye.

---

## F6 — `admin — cobro`

3 jornadas. Fuente: `PLAN §5b` ("gestión de los QR"), `PLAN §7` (pestaña 3),
`REPORTE ADM-07`, D-01, D-08.

Es la pestaña que menos se visita, pero cuando se la necesita —cambió de banco a
media jornada— tiene que resolverse sin llamar al desarrollador (`PLAN §7`).

Solo **ADMIN** (`PLAN §5g`).

### RQ-713 — QR en tarjetas con la imagen visible y el activo destacado

Fuente: `PLAN §7` (pestaña 3), `PLAN §5b`.

- Los QR guardados se muestran como **tarjetas con la imagen visible**, no como
  filas de texto. El operador reconoce su QR por la imagen, no por el `id`.
- El **activo está destacado** visualmente, sin ambigüedad.
- La `etiqueta` es **texto libre suyo**, solo para distinguirlos. El sistema no la
  interpreta (`PLAN §5b`, decisión intencional).

### RQ-714 — Subir un QR nuevo desde el celular

Fuente: `PLAN §5b`, `PLAN §6` (`POST /admin/qrs`, multipart).

- Foto o captura desde la galería del celular.
- El servidor **valida que sea una imagen y la redimensiona**.
- El servidor **no lee ni valida el contenido del QR** (`PLAN §5b`, decisión
  intencional): los formatos de QR Simple varían por banco y una validación a
  medias rechazaría QR legítimos, que es peor que no validar. Quien sube es
  responsable de subir el correcto.

Esto hay que decirlo en la UI: el sistema no puede avisar si subió el QR
equivocado.

### RQ-715 — Activar un QR

Fuente: `PLAN §5b`, `PLAN §6` (`POST /admin/qrs/:id/activate`), `PLAN §7`.

- Cambiar de QR es **un toque, sin reiniciar nada**.
- La tablet lo recibe por WebSocket (`qr.changed`, `PLAN §6`).
- Afecta a los **pedidos nuevos**. Un pedido ya creado conserva el QR que se le
  mostró (RQ-616 de S6, `REPORTE V13`).
- Es un **evento financiero**: va al log de auditoría, porque cambia la cuenta a
  la que entra el dinero (`PLAN §5b`), dentro de la transacción (D-07).

Pendiente (`REPORTE ADM-07`): evitar dos activos por concurrencia. Es requisito
del servidor (B8), no de esta UI, pero el panel no debe asumir que la lista que
tiene en pantalla sigue siendo válida.

### RQ-716 — Archivar, nunca borrar

Fuente: `PLAN §5b`, `PLAN §6` (`POST /admin/qrs/:id/archive`),
`docs/README.md` regla 6.

- No existe "eliminar". Existe **archivar**.
- Un QR archivado sigue existiendo porque los pedidos viejos apuntan a él. Al
  borrarlo de verdad se perdería la trazabilidad de a qué cuenta entró cada pago
  (`PLAN §5b`).

### RQ-717 — Nunca cero QR activos

Fuente: `PLAN §5b`.

- Si se intenta archivar el único activo, **el sistema lo impide y explica por
  qué**: el kiosco no podría cobrar y las ventas se detienen.
- El panel muestra una **alerta** si no hay QR activo.

Aceptación: `POST /admin/qrs/:id/archive` sobre el único activo devuelve un
rechazo con motivo legible, y la UI lo muestra como explicación, no como error
técnico.

Pendiente (`REPORTE ADM-07`): el estado inicial sin ningún QR y cómo se impide
vender en ese estado. El seed de B2 (S1) siembra uno activo, lo que tapa el caso
en desarrollo pero no lo resuelve.

### RQ-718 — La imagen de un QR usado es inmutable

Fuente: D-08, `PLAN §5b`, `REPORTE H04`, `REPORTE ADM-07`.

Archivar no alcanza. Si se permite editar la imagen de un `PaymentQr` existente,
los pedidos que apuntan a él quedan referenciando una imagen que no es la que se
mostró, y el cuadre por cuenta deja de ser auditable.

- Una vez que un QR tiene **al menos un pedido asociado**, su `imagenUrl` no se
  modifica.
- Cambiar la imagen **crea una fila nueva y archiva la anterior**.
- Editar sigue siendo posible solo mientras el QR **no haya sido usado** en ningún
  pedido.

La UI tiene que reflejar esto: el botón de editar imagen desaparece en cuanto el
QR tiene pedidos, y se explica que subir una imagen distinta crea un QR nuevo.

### RQ-719 — Cuadre del día desglosado por QR

Fuente: `PLAN §7` (pestaña 3, "debajo, el cuadre del día desglosado por QR"),
`PLAN §5b` ("cada orden guarda el `paymentQrId`"), `PLAN §6`
(`GET /admin/reports/closing`), `REPORTE ADM-08`.

- Debajo de las tarjetas, el cuadre del día **separado por QR / cuenta**.
- Es **indispensable si cambió de QR a media jornada**, porque si no el cuadre
  nunca da (`PLAN §5b`).
- Solo ADMIN (`PLAN §5g`).

Acá va únicamente la vista por QR que acompaña a la gestión de QR. El cierre
completo —cuatro cifras separadas, desglose por operador, devoluciones
pendientes— es B12/S9, y su contenido está bloqueado por la regla 6 de `PLAN §5e`
(pendiente de aprobación de la dueña).

---

## Qué se demuestra al cerrar S7

1. Se crea un pedido en la tablet y aparece en la cola del panel con sonido y
   contador.
2. Se tipea el monto en el buscador, con el foco ya puesto, y el pedido aparece
   con número, nombre, antigüedad e items.
3. Se confirma y el pedido pasa a `PAGADO`, con `AuditLog` en la misma
   transacción y `confirmadoPorId` del usuario que confirmó.
4. Se confirma desde la cola y aparece el diálogo con el monto en grande y la
   pregunta "¿recibiste Bs X de este pedido?". No hay forma de confirmar con un
   solo toque.
5. Se crean dos pedidos de Bs 45 y el panel los marca como ambiguos y no deja
   confirmar hasta elegir uno por nombre.
6. Con sesión de CAJA, el camino de confirmar con diferencia no aparece, y
   llamando al endpoint a mano el servidor lo rechaza.
7. Se sube un QR nuevo desde el celular, se activa, y la tablet cambia la imagen
   sin reiniciarse.
8. Se intenta archivar el único QR activo y el sistema lo impide explicando por
   qué.
9. Un QR con pedidos asociados no permite editar su imagen.
10. El cuadre del día se ve separado por QR.

---

## Tests de este sprint

Fuente: `ARQUITECTURA §8`.

Unitarios, sin DB:
- Detección de ambigüedad: dado un conjunto de pedidos abiertos, la función pura
  que decide cuáles son ambiguos marca exactamente los que comparten total.
- Permisos de la UI: la vista de CAJA no compone el camino de diferencia ni el de
  cancelación (verificación de armado de la vista, no sustituto del guard).
- `Money`: el monto que se muestra en el diálogo de confirmación es un entero y no
  muestra centavos (D-04).

Integración, con DB:
- Confirmación de pago: deja la orden en `PAGADO` y una fila en `AuditLog` dentro
  de la misma transacción (`ARQUITECTURA §8`, D-07).
- Dos confirmaciones simultáneas del mismo pedido: una sola confirmación efectiva
  y un solo registro financiero (`REPORTE V06`, `V27`).
- Confirmación y vencimiento simultáneos: resultado consistente, sin pago
  autorizado sobre un pedido cancelado (`REPORTE V07`).
- Confirmación de pedido ambiguo sin desambiguación: rechazada por el servidor
  (`REPORTE §16.4`).
- CAJA intenta confirmar con diferencia, cancelar, gestionar QR o ver el cuadre:
  rechazado por el servidor, no solo oculto (`REPORTE V25`).
- Archivar el único QR activo: rechazado (`PLAN §5b`).
- Editar la imagen de un QR con pedidos asociados: rechazado; subir otra crea
  fila nueva y archiva la anterior (D-08).
- `AuditLog` registra el cambio de QR activo (`PLAN §5b`).

---

## Fuera de alcance en S7

- Cuadre de cierre completo con las cuatro cifras separadas y desglose por
  operador: es B12, S9, y su contenido está bloqueado por `PLAN §5e` regla 6.
- Vista del log de auditoría (B12/S9). En S7 la auditoría se escribe; leerla es
  después.
- Lista y cierre de `Refund` (S9). Cancelar un pedido pagado es ADMIN y genera un
  `Refund` pendiente (D-09), pero la pantalla de gestión de devoluciones es S9.
- Gestión de usuarios y revocación de permisos (B13/F9, S5).
- KDS de cocina (S8). En S7 el pedido pasa a `PAGADO` y el evento se emite, pero
  no hay tablero que lo reciba.
- Cualquier integración bancaria, webhook o conciliación automática (D-01,
  `REPORTE §16.1`). El sistema no sabe si entró un pago y no va a saberlo en el
  MVP.
- Lectura o validación del contenido del QR (`PLAN §5b`, decisión intencional).
- Validación automática del nombre del remitente contra el nombre del pedido: el
  nombre es señal blanda (R-01).

---

## Riesgos

**El botón verde.** Es el riesgo central de todo el sistema y no es técnico. Con
la fila de gente mirando, cualquier diseño que permita confirmar rápido se va a
usar para confirmar sin mirar el banco. `PLAN §5b` lo anticipa textualmente. Cada
vez que alguien proponga "agregar un acceso rápido" a esta pantalla, la respuesta
por defecto es no, y la carga de la prueba es de quien lo propone.

**Aflojar la desambiguación porque molesta.** RQ-703 es fricción deliberada, y con
dos pedidos de Bs 45 en cola va a resultar incómoda justo en el momento de más
apuro. Es el único control estructural que queda tras D-04 (R-01). Si se
convierte en un aviso que se puede ignorar, R-01 deja de estar mitigado y pasa a
estar simplemente abierto.

**Presentar esto como verificación robusta.** `REPORTE §16.4` y R-01 son
explícitos: es un riesgo residual aceptado, no un problema resuelto. Tres de los
cuatro vectores de fraude de `PLAN §5b` siguen abiertos. En cualquier informe,
demo o presentación a la dueña hay que decirlo así. La salida real es el QR
dinámico, diferido a v2 por falta de NIT y cuenta empresa (D-01).

**Construir la UI antes de que B8 esté cerrado.** S7 depende de B8 y B8 depende de
las políticas de `PLAN §5e`, que la dueña todavía no aprobó. Si se construye la
pantalla de diferencias contra la tolerancia propuesta de Bs 2 y ella decide otra
cosa, se rehace. La versión restrictiva de RQ-707 (toda diferencia es ADMIN)
existe para no quedar colgados de esa respuesta.

**Escribir "panel de la dueña" en el código.** `PLAN §7` lo llama así por historia
del documento, pero D-02 incorporó CAJA. Un componente llamado `OwnerPanel` o una
variable `esDueña` empuja a decisiones de permiso dentro de la UI, que es
exactamente lo que `PLAN §5g` prohíbe. El nombre correcto es panel de cobro, y el
permiso lo resuelve el servidor.

**R-02 no se mitiga desde acá.** La cajera opera con el celular del negocio con la
banca móvil abierta y eso normalmente permite transferir (R-02, `PLAN §5g`).
Ningún requerimiento de S7 cambia eso: los controles son todos externos al
software (cuenta dedicada con saldo bajo, acceso de solo consulta si el banco lo
ofrece, acuerdo de responsabilidad). No corresponde inventar un control de
software que finja resolverlo.
