# S4 — Pagos y auditoría

**Módulos:** B8 `payments`, B10 `audit`, B11 `realtime`
**Estimación:** 15,5 jornadas
  - B8 `payments` — 7,5 j (6 base, menos pool de sufijos, más desambiguación 1 j,
    `PaymentProof` 0,5 j, `Refund` 1 j)
  - B10 `audit` — 2,5 j (2 base, más `targetUserId` y acciones de permisos 0,5 j)
  - B11 `realtime` — 3 j
  - Reserva de riesgo — 2,5 j
**Estado:** **LISTO PARA EJECUTAR** desde el 2026-10-17. Es el sprint de más
riesgo del proyecto.

Bloqueos cerrados el 2026-10-17:
- Acceso de consulta bancaria para CAJA → **D-15**. La dueña aceptó que una
  cajera de confianza vea los movimientos y confirme. Era el bloqueo del camino
  crítico completo.
- Riesgo del celular prestado → **D-16**. El QR apunta a una cuenta separada con
  saldo bajo; la dueña transfiere lo recaudado al cierre. Hace irrelevante si la
  app puede transferir sin pedir clave.
- Regla 1 → **D-11**: toda diferencia la autoriza ADMIN, sin umbral.
- Regla 4 → **D-12**: el pedido vencido no se revive, se crea uno nuevo.
- Regla 5 → **D-14**: el día va de 5:00 a 5:00 y cuenta por fecha de pago.
- Nombre del cliente → **D-13**: obligatorio, es lo que permite desempatar.
- Efectivo → **D-17**: fuera del MVP. B8 solo maneja pago con QR.

Sigue pendiente, pero **no bloquea**: políticas 2, 3 y 7 de `PLAN §5e` (pagó de
más, cancelar pagado, plato no preparable). Afectan el detalle de `RQ-409`
(`Refund`) y el cierre de S9, no la confirmación de pago.

---

## Objetivo

Que el dinero entre al sistema con autoría verificable: alguien ve el abono en
el banco, lo confirma, el pedido pasa a cocina, y queda registrado quién lo hizo.

Al cerrar S4 el sistema ya puede cobrar. Es el sprint que convierte el proyecto
en algo que maneja plata real.

---

## Por qué este sprint es el de más riesgo

Tres razones, todas documentadas:

**1. Es el único punto donde el sistema no puede verificar nada por sí mismo.**
`PLAN §5b` lo dice explícito: "no leemos ni validamos el contenido del QR". La
verificación es humana por diseño forzado, no por falta de ganas. Todo lo que
construimos acá existe para que esa decisión humana quede registrada y sea
auditable.

**2. Los precios enteros reabrieron tres de los cuatro vectores de fraude.**
D-04 derogó el sufijo de centavos, que era el mecanismo que hacía único el monto
de cada pedido. Sin él, dos pedidos de Bs 45 son indistinguibles para quien mira
el extracto bancario. El único control estructural que queda es la
desambiguación obligatoria (RQ-407, R-01).

**3. Si la auditoría se implementa mal, no se nota hasta que importa.**
Un listener post-commit que escribe `AuditLog` funciona el 99,9% de las veces.
La vez que el servidor se reinicia en esa ventana, queda un cobro sin autor — y
es justo el día que la dueña necesita explicar por qué falta plata.

---

## B8 — `payments`

7,5 jornadas. Fuente: `PLAN §5b`, `PLAN §5e`, `PLAN §5f`, `PLAN §6`,
`ARQUITECTURA §2`, D-02, D-04, D-05, D-08, D-09.

Profundidad de slice: **con `domain/` puro**. Fuente: `ARQUITECTURA §2`, tabla
de profundidad variable. Es uno de los dos slices (con `orders`) donde la lógica
de dominio se separa de Prisma, porque las reglas de confirmación tienen que ser
testeables sin base de datos.

### RQ-401 — CRUD de QR de cobro

Fuente: `PLAN §5b` ("varios QR gestionables, uno activo"), `PLAN §6`
(`CRUD /admin/payment-qrs`), D-08.

- Subir un QR: imagen más una etiqueta de texto libre.
- La etiqueta es solo para que la dueña los distinga en el panel. **El sistema no
  la interpreta** (`PLAN §5b`): no se parsea el QR ni se valida que corresponda a
  una cuenta real.
- Activar un QR desactiva el anterior, en la misma transacción.
- Archivar un QR lo saca de la rotación pero no lo borra: los pedidos viejos lo
  referencian.

Aceptación:
- Nunca hay dos QR activos en el mismo local. Ya lo garantiza el índice único
  parcial `qr_unico_activo_por_local` de B2 (RQ-107), pero el servicio debe
  devolver un error legible en vez de dejar que explote la constraint.
- Nunca hay cero QR activos: intentar archivar el único activo es rechazado con
  un mensaje que explique por qué (el kiosco no podría cobrar).

### RQ-402 — La imagen de un QR usado es inmutable

Fuente: D-08, `PLAN §5b`, `REPORTE H04`.

- Si un `PaymentQr` ya tiene pedidos asociados, su `imagenUrl` **no se puede
  editar**. Reemplazar la imagen crea una fila nueva y archiva la anterior.
- La etiqueta sí se puede corregir: es texto para humanos, no afecta trazabilidad.

Motivo: si se editara la imagen en el lugar, los pedidos viejos quedarían
apuntando a una imagen que no es la que se les mostró, y el cuadre por cuenta
dejaría de ser auditable. Es el hallazgo `H04`, cerrado en `PLAN §5b` el
2026-10-16.

Aceptación:
- `PUT` de `imagenUrl` sobre un QR con pedidos devuelve 409 con explicación.
- El mismo `PUT` sobre un QR sin pedidos funciona.

### RQ-403 — Validación de la imagen en el servidor

Fuente: `PLAN §5b` ("el servidor valida que sea una imagen y la redimensiona").

- Verificar que el archivo sea realmente una imagen, no confiar en la extensión
  ni en el `Content-Type` que manda el cliente.
- Redimensionar a un tamaño razonable para la pantalla del kiosco.
- Almacenar detrás de la interfaz `ImageStorage` (`ARQUITECTURA §4`).

### RQ-404 — Buscar pedidos abiertos por monto

Fuente: `PLAN §5b` (el panel de confirmación), `REPORTE ADM-03`.

- Endpoint que recibe un monto y devuelve los pedidos `PENDIENTE_PAGO` cuyo
  total coincide.
- Usa el índice `(locationId, estado, total)` creado en B2.
- Devuelve también cuántos pedidos abiertos hay con ese mismo total: es el dato
  que dispara la desambiguación de RQ-407.

Este es el endpoint del flujo real: la persona ve "entró Bs 45" en el banco,
tipea 45, y el pedido aparece. **Al revés de lo intuitivo**: no busca el pedido
y luego verifica el pago, sino que parte del pago confirmado.

### RQ-405 — Confirmar un pago

Fuente: `PLAN §5b`, `PLAN §5g`, D-02, D-07, `REPORTE C-03`.

La operación central del sistema. Dentro de **una sola transacción**:

1. Verificar que el pedido esté en `PENDIENTE_PAGO`.
2. Verificar que el actor tenga permiso (`CAJA` o `ADMIN`, `PLAN §5g`).
3. Cambiar el estado a `PAGADO`.
4. Grabar `pagadoEn` y `confirmadoPorId`.
5. Escribir la fila de `AuditLog` con acción `PAGO_CONFIRMADO`.

El commit incluye los cinco pasos o ninguno.

- La autoría sale del **usuario autenticado**, nunca del body. Si el cliente
  pudiera enviar quién confirmó, el log dejaría de ser prueba.
- `Order.confirmadoPorId` ya existe en el modelo desde B2.

Aceptación:
- Confirmar un pedido ya pagado devuelve 409, no duplica nada.
- Confirmar un pedido cancelado o vencido devuelve 409.
- No existe ningún camino que deje `estado = PAGADO` sin fila de auditoría.

### RQ-406 — La auditoría financiera se escribe dentro de la transacción

Fuente: D-07, `ARQUITECTURA §3` (excepción de auditoría financiera),
`REPORTE H06`.

**Este es el requerimiento que más fácil se implementa mal.**

`ARQUITECTURA §3` establece como regla general que los eventos de dominio se
emiten **después** del commit. Es correcto para notificar al KDS: si se emitiera
dentro y la transacción fallara, cocina recibiría un pedido que no existe.

Pero la auditoría de operaciones financieras es la excepción, y aplica a:
confirmación de pago, cancelación, cambio de precio y cambio de QR.

Razón: el evento post-commit es *at-most-once*. Si el proceso muere entre el
commit y la emisión, el cambio quedó y el registro no. Para una notificación eso
es recuperable — el KDS refresca por HTTP. Para la autoría de un cobro no hay
recuperación posible: el dato se perdió.

Con dos personas habilitadas para confirmar (dueña y caja, D-02), ese es
precisamente el dato que no se puede perder.

Implementación:
- `AuditLog` se escribe con el mismo cliente transaccional (`tx`) que el cambio
  de estado, no con el cliente global.
- El evento WebSocket sí se emite después del commit (RQ-414).

Aceptación:
- Un test que falle la transacción a propósito debe dejar la base sin el cambio
  **y** sin la fila de auditoría.
- Revisar que ningún servicio de este sprint escriba `AuditLog` desde un
  listener de eventos.

### RQ-407 — Desambiguación obligatoria de montos iguales

Fuente: R-01, `PLAN §5b`, D-04, `REPORTE §16.4`.

**Es el único control estructural que queda contra el fraude de monto, después
de que D-04 derogara el sufijo de centavos.**

Cuando hay dos o más pedidos `PENDIENTE_PAGO` con el mismo total:

- El sistema **no permite confirmar a ciegas**.
- Presenta los pedidos candidatos con todo lo que los distingue: número, hora de
  creación, nombre del cliente si lo dejó, y los ítems.
- Quien confirma elige explícitamente cuál.
- La elección queda en `AuditLog` con el detalle de que hubo ambigüedad y
  cuántos candidatos había.

Motivo: sin esto, dos clientes que piden lo mismo por Bs 45 son indistinguibles
en el extracto bancario. Uno paga, el otro no, y quien confirma no tiene forma
de saber cuál. Confirmar el primero de la lista le daría comida gratis al que no
pagó, y dejaría al que pagó esperando.

El nombre del cliente es **señal blanda** (`PLAN §5b`): la gente paga desde la
cuenta de la mamá, del hermano o de un amigo. Sirve para desempatar, no para
bloquear.

Aceptación:
- Con un solo pedido de Bs 45 abierto: confirmación directa.
- Con dos: el endpoint de confirmación directa devuelve 409 y obliga a usar el
  endpoint que especifica el `orderId`.
- La fila de auditoría registra `candidatos: 2`.

### RQ-408 — Confirmar con diferencia de monto, solo ADMIN

Fuente: `PLAN §5b`, `PLAN §5e` regla 1 y 2, D-02, **D-11**.

- Endpoint separado del de confirmación normal.
- Reservado a `ADMIN`. `CAJA` no lo ve ni lo puede llamar.
- Recibe el monto efectivamente recibido, lo graba en `Order.montoRecibido`.
- Escribe `AuditLog` con acción `PAGO_CONFIRMADO_CON_DIFERENCIA`, el monto
  esperado y el recibido.

**No hay umbral de tolerancia.** D-11 cerró esta regla: cualquier diferencia, por
chica que sea, requiere ADMIN. La propuesta original de `PLAN §5e` regla 1
("hasta Bs 2 lo confirma CAJA") quedó descartada.

Motivo de D-11: un umbral para CAJA es un monto que se puede regalar sin pedirle
permiso a nadie, y en el log cada caso se vería como una confirmación normal. Con
300 pedidos diarios, Bs 2 de tolerancia son Bs 600 de margen discrecional por
día. Aceptar menos plata que el total es una decisión comercial (`PLAN §5g`).

Consecuencia aceptada: la dueña va a ser interrumpida cada vez que un cliente
tipee mal el monto.

Aceptación:
- El endpoint de confirmación normal exige coincidencia **exacta**: una diferencia
  de Bs 1 es rechazada con 409.
- `CAJA` llamando al endpoint de diferencia recibe 403.
- No existe ningún parámetro de configuración de umbral.

### RQ-409 — `Refund`: la obligación de devolver

Fuente: D-09, `PLAN §5e` regla 3, `REPORTE H05`.

**Cancelar un pedido pagado no devuelve dinero. Crea una obligación pendiente.**

- Cancelar un pedido en estado `PAGADO`, `EN_PREPARACION` o `LISTO` crea una fila
  en `Refund` con estado `PENDIENTE`.
- Solo `ADMIN` puede cancelar un pedido pagado (`PLAN §5g`, D-02).
- La fila registra monto, motivo y quién autorizó.
- Un endpoint aparte permite **cerrar** el refund: quién devolvió la plata,
  cuándo y cómo (efectivo, transferencia).
- La base ya exige que un refund cerrado tenga autor y fecha (constraint
  `refunds_cerrado_tiene_autoria` de B2).

Motivo: sin esta tabla, el cierre presentaría como venta vigente un dinero que
hay que devolver, y el cuadre nunca daría. El sistema **recuerda la deuda, no
mueve plata** — no hay integración bancaria (D-01).

Aceptación:
- Cancelar un pedido pagado crea exactamente un `Refund` pendiente, en la misma
  transacción que la cancelación.
- Cancelar un pedido `PENDIENTE_PAGO` **no** crea refund: nunca entró plata.
- El cierre de S9 debe poder listar los refunds pendientes.

### RQ-410 — `PaymentProof`: comprobante solo ante conflicto

Fuente: D-05, `PLAN §5f`.

- `CAJA` o `ADMIN` pueden adjuntar una foto a un pedido, fotografiando la
  pantalla del celular del cliente con la tablet.
- Se registra quién la subió y por qué (el cliente dice que pagó y no aparece,
  el monto no coincide).

**El comprobante NO autoriza la confirmación de un pago.** Es evidencia para una
reclamación posterior, nada más.

Motivo, de D-05: si el flujo normal pidiera comprobante, quien confirma
terminaría mirando la captura en vez del extracto bancario — es más rápido y hay
fila de gente. Eso **degrada** el control en lugar de reforzarlo, porque la
captura es falsificable y reutilizable (vector "captura reciclada" de
`PLAN §5b`).

Aceptación:
- El endpoint de confirmación de pago **no** acepta ni requiere un
  `paymentProofId`. Son operaciones independientes.

**Pendiente de decisión:** cuánto tiempo se guardan estas imágenes. Son datos de
terceros y ocupan disco. Pregunta que lo desbloquea: `PREGUNTAS` 14.

### RQ-411 — Vencimiento de pedidos impagos

Fuente: `PLAN §5b` (carritos abandonados), `PLAN §5e` regla 4, `REPORTE H02`,
**D-12**.

- Job que cancela los pedidos `PENDIENTE_PAGO` que pasaron el timeout.
- El timeout se lee de `Setting` (`pedido.timeout_minutos`, sembrado en B2 con
  valor 15), no de una constante.
- El actor de la transición es `SISTEMA` (ya está en la matriz de B1).
- No crea `Refund`: nunca entró plata.

**El pedido vencido no se revive.** D-12 cerró `H02`: si el pago llega después,
CAJA genera un pedido **nuevo** con los mismos ítems y lo confirma con ese pago.
`CANCELADO` sigue siendo terminal en la máquina de estados.

Motivo de D-12: abrir `CANCELADO → PENDIENTE_PAGO` permitiría resucitar un pedido
viejo y atarle el pago de otro cliente —sin el sufijo de centavos (D-04) no hay
forma de distinguirlo—, obligaría a decidir si el número de pedido se reusa (lo
que rompe el único por `(fecha, locationId)`), y el plato pudo agotarse en esos
20 minutos.

Requerimiento derivado: **CAJA necesita "repetir este pedido"**, que copie los
ítems de un pedido cancelado en uno nuevo con dos toques. Sin eso, el atajo va a
ser confirmar algo a mano. Entra en B7 (S3) y en la pantalla F4 (S7).

Aceptación:
- Un pedido vencido queda en `CANCELADO` y no acepta ninguna transición.
- No existe endpoint que reabra un pedido cancelado.
- "Repetir pedido" crea una fila nueva con número nuevo, y la auditoría muestra
  las dos: la cancelación por timeout y la venta nueva.

### RQ-412 — Cuadre por QR

Fuente: `PLAN §5c`, `PLAN §5b`.

- Consulta que agrupa los pedidos pagados del día por `paymentQrId`.
- Permite que la dueña compare cada subtotal con el extracto de la cuenta
  correspondiente.

Indispensable si cambió de QR a media jornada: sin esto, tendría un solo total
que no cuadra con ninguna de las dos cuentas.

---

## B10 — `audit`

2,5 jornadas. Fuente: `PLAN §5c`, D-07, `REPORTE C-02`.

### RQ-413 — Consulta del log de auditoría

Fuente: `PLAN §5c` ("log filtrable con quién, cuándo, monto esperado, monto
ingresado, discrepancia"), `PLAN §6` (`GET /admin/audit`).

- Solo `ADMIN`.
- Filtros: rango de fechas, usuario, acción, pedido.
- Paginado: el log crece todos los días y no se puede devolver completo.
- Incluye las acciones de permisos vía `targetUserId` (`REPORTE C-02`), aunque
  B13 se construya en S5. La columna ya existe desde B2.

El log existe "para poder explicar un cierre que no cuadra" (`PLAN §7`). El
diseño de la consulta tiene que servir a esa pregunta concreta: *¿quién confirmó
los cobros de ayer entre las 13:00 y las 14:00?*

### RQ-414 — El log no se puede editar ni borrar

Fuente: `PLAN §5c`, implícito en el propósito del log.

- No hay endpoint de `UPDATE` ni de `DELETE` sobre `AuditLog`.
- Nadie, ni `ADMIN`, puede modificar una fila.

Motivo: un log editable por quien podría querer ocultar algo no es un log.

**Pendiente de decisión:** retención. El log crece sin límite. Definir si se
archiva después de N meses y a dónde. No es urgente para el MVP pero conviene
anotarlo antes de que la tabla tenga un millón de filas.

---

## B11 — `realtime`

3 jornadas. Fuente: `PLAN §6` (eventos WebSocket), `ARQUITECTURA §3`.

### RQ-415 — Gateway con namespaces por rol

Fuente: `PLAN §6`, `PLAN §5g`, `ARQUITECTURA §3`.

- Socket.IO con namespaces separados: cocina no recibe eventos de cobro, el
  kiosco no recibe nada del panel.
- La conexión se autentica con el mismo JWT que la API.
- Un socket cuyo usuario fue desactivado se cierra: la revocación inmediata de
  RQ-114 tiene que alcanzar también a las conexiones abiertas.

### RQ-416 — Eventos emitidos después del commit

Fuente: `ARQUITECTURA §3`.

- Los eventos de dominio se emiten **después** del commit de la transacción.
- Si se emitieran dentro y la transacción fallara, cocina recibiría un pedido que
  en la base no existe.
- Al revés es recuperable: si el commit funcionó y el push falló, el KDS lo ve en
  el próximo refresh.

Esto **no contradice** RQ-406: la auditoría va dentro de la transacción porque es
un registro que no se puede perder; el evento va después porque es una
notificación que se puede reconstruir.

### RQ-417 — El KDS siempre puede reconstruir por HTTP

Fuente: `ARQUITECTURA §3`, `REPORTE COC-02`.

- Al conectarse, el KDS trae el estado completo por HTTP.
- El WebSocket solo transporta cambios incrementales.
- Si el socket se cae y vuelve, reconstruye por HTTP de nuevo.

Motivo: una cocina que depende del socket para saber qué preparar se queda ciega
cuando el WiFi hipa. Y el WiFi del local va a hipar.

---

## Qué se demuestra al cerrar S4

1. La dueña sube un QR desde el celular y lo activa. El anterior se desactiva
   solo.
2. Intentar archivar el único QR activo falla con un mensaje claro.
3. Se crea un pedido de Bs 45. Alguien con rol CAJA tipea 45 en el panel, el
   pedido aparece, lo confirma, pasa a `PAGADO`.
4. El log de auditoría muestra que lo confirmó esa persona, a esa hora.
5. Con dos pedidos de Bs 45 abiertos, la confirmación directa es rechazada y hay
   que elegir cuál explícitamente. La elección queda registrada con `candidatos: 2`.
6. CAJA intenta confirmar con diferencia de monto: 403.
7. ADMIN confirma con diferencia: queda en auditoría el esperado y el recibido.
8. ADMIN cancela un pedido pagado: se crea un `Refund` pendiente.
9. Se cierra el refund registrando quién devolvió la plata.
10. Un pedido impago pasa el timeout y se cancela solo, sin crear refund.
11. El cuadre del día muestra los totales separados por QR.
12. Matar el proceso a mitad de una confirmación deja la base sin el cambio y sin
    la fila de auditoría — nunca una sin la otra.

---

## Tests de este sprint

**Unitarios, sin DB** (`domain/` de payments):
- Reglas de confirmación: estado válido, actor autorizado, monto coincidente.
- Cálculo de diferencia: exacto, faltante, excedente.
- Detección de ambigüedad: dado un conjunto de pedidos abiertos y un monto,
  ¿cuántos candidatos hay?
- Decisión de crear refund: qué estados implican que entró plata.

**Integración, con DB:**
- Confirmación de pago completa: estado, `pagadoEn`, `confirmadoPorId` y
  `AuditLog` en una transacción.
- **Atomicidad de la auditoría**: forzar el fallo de la transacción y verificar
  que no quede ni el cambio ni la fila. Es el test que protege D-07.
- Doble confirmación concurrente del mismo pedido: una gana, la otra recibe 409.
- Dos QR activos simultáneos: rechazado por la constraint.
- Archivar el único activo: rechazado por el servicio.
- Editar la imagen de un QR con pedidos: 409.
- Desambiguación: con dos pedidos del mismo monto, confirmación directa
  rechazada.
- Cancelación de pagado crea refund; de impago no.
- Vencimiento por timeout no crea refund.
- Un socket de un usuario desactivado se cierra.

---

## Fuera de alcance en S4

- **Webhooks y QR dinámico** (D-01). Diferido a v2: requiere NIT, cuenta
  empresa y contrato de cobranza.
- **Pago en efectivo** (D-17). Diferido a v2. El MVP solo maneja QR. Cuando
  entre, trae consigo el arqueo de caja (conteo de apertura y cierre) y el
  cierre separado por medio de pago.
- **Pool de sufijos de centavos** (D-04). Derogado.
- **Conciliación automática** banco↔pedido. No hay integración bancaria; el
  emparejamiento es manual por diseño.
- **La pantalla** del panel de cobro. Es F4/F6, sprint S7. S4 construye la API.
- **Reportes de cierre**. Es B12, sprint S9. S4 deja el cuadre por QR como
  consulta; la presentación de las cuatro cifras separadas es de S9.
- **Gestión de usuarios**. Es B13, sprint S5.

---

## Riesgos

**Que alguien implemente la auditoría por listener.** Es el riesgo número uno de
este sprint. El patrón de eventos post-commit está en `ARQUITECTURA §3` como
regla general y es tentador aplicarlo a todo por consistencia. Si se hace, el
sistema funciona perfecto en desarrollo y pierde la autoría de un cobro el día
que el servidor se reinicia a mitad de una transacción. Mitigación: el test de
atomicidad de RQ-406, y una revisión explícita de que ningún `AuditLog` de este
sprint se escriba fuera de un `tx`.

**Que la desambiguación se sienta como un estorbo y alguien la saque.** Con fila
de gente esperando, un diálogo que obliga a elegir entre dos pedidos iguales se
va a percibir como burocracia. Es el único control estructural que queda contra
el fraude de monto (R-01). Si se elimina, el sistema vuelve a ser confirmable a
ciegas. Mitigación: que el diálogo muestre información que realmente ayude a
decidir — hora, nombre, ítems — en vez de dos filas idénticas.

**Que se confirme contra la captura del cliente.** Resuelto en lo organizativo por
D-15: quien confirma tiene acceso de consulta bancaria, así que no necesita
mirar la captura. Pero el riesgo no desaparece del todo: con fila de gente, mirar
la pantalla del cliente sigue siendo más rápido que abrir la app del banco.
Mitigación en el diseño de F4 (S7): el diálogo de confirmación pregunta
"¿recibiste Bs X de este pedido?" y nunca ofrece un comprobante como evidencia
suficiente (D-05, `RQ-410`).

**Que la cuenta de cobros acumule saldo.** D-16 acota el daño del celular
prestado suponiendo que la dueña transfiere lo recaudado al cierre de cada
jornada. Si no lo hace, la cuenta junta plata y el beneficio desaparece. Es un
hábito, no un control del sistema: no hay nada en el código que lo fuerce.
Mitigación: incluirlo como paso del procedimiento de cierre en el manual de
operación (S10).

**Que el emparejamiento manual no escale en hora pico.** Sin sufijo y sin
integración, la persona que confirma tiene que leer el extracto, buscar el monto
en el panel y decidir. Con tres clientes por minuto eso se acumula. Es una
consecuencia aceptada de D-01 y D-04, y debe quedar escrito como límite conocido:
el sistema no promete velocidad de confirmación, promete trazabilidad.

**Que el timeout cancele pedidos de gente que sí pagó.** Quince minutos parece
suficiente, pero alguien que paga desde una app bancaria lenta, con mala señal,
puede pasarse. El pedido se cancela y el pago llega después. Está anotado como
`H02` y pendiente de política. Mitigación provisoria: que el timeout sea
configurable desde `Setting` y arranque conservador.
