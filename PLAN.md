# Sistema de gestión — Restaurante

Plan de proyecto. Etapa: **planificación**. Última actualización: 2026-10-01.

---

## 1. Resumen del producto

Kiosco de autoservicio para un restaurante. El cliente llega, pide en una tablet
ubicada en la entrada, paga escaneando el QR de la dueña, y espera a que la cocina
le prepare el pedido. Puede comer en el local o llevarlo.

No hay integración bancaria: el QR es **estático** (el QR personal de la dueña),
así que el sistema no puede detectar el pago por sí solo. La dueña confirma cada
pago manualmente desde su panel. Esta es la restricción central que define todo
el flujo.

---

## 2. Decisiones tomadas

| Tema | Decisión |
|---|---|
| App cliente | React Native + Expo (Expo Router) |
| API | NestJS + PostgreSQL + Prisma |
| Tiempo real | WebSockets (Socket.IO) para cocina y panel de pagos |
| Pago | QR estático, sin pasarela. **Varios QR gestionables, uno activo** (§5b) |
| Confirmación de pago | ADMIN (dueña) o CAJA confirman en su panel; recién ahí entra a cocina |
| Montos | **Bolivianos enteros.** El sufijo de centavos queda derogado (§5b, REPORTE §16.4) |
| Dispositivos fase 1 | Tablet del local (kiosco) + navegador para CAJA/ADMIN/cocina |
| Identificación del pedido | Nombre del cliente + número de pedido diario (ej. `#42`) |
| Catálogo | Items simples + categorías + notas libres + variantes de tamaño opcionales |
| Roles | `ADMIN` (dueña), `CAJA`, `COCINA`, y el kiosco sin login |
| País / moneda | Bolivia — bolivianos (Bs), montos enteros |
| Servidor | PC en el local, en la LAN. Postgres y API locales. |

### Fuera de alcance en fase 1
- Pedidos desde el celular del cliente (fase 2 — la misma app Expo se publica sin reescribir)
- Cuentas de cliente, login, historial, fidelización
- Añadidos con costo (extras pagos, quitar ingredientes)
- Notificaciones por WhatsApp/SMS
- Delivery, reservas, mesas, propinas
- Facturación electrónica / integración con impuestos

---

## 3. Arquitectura

Monorepo con dos paquetes y un paquete de tipos compartidos.

```
restaurante/
├── apps/
│   ├── api/          NestJS + Prisma + PostgreSQL + Socket.IO
│   └── app/          Expo (Expo Router) — compila a Android nativo y a web
├── packages/
│   └── shared/       tipos TS, schemas Zod, máquina de estados del pedido
├── docker-compose.yml
└── PLAN.md
```

Un solo código de UI sirve a los tres usos, separados por ruta y por rol:

- `/kiosk` → build nativo Android, corre en la tablet de la entrada
- `/kds` → build web, corre en el navegador de la tablet/PC de cocina
- `/admin` → build web, corre en el celular o PC de la dueña

**Por qué una sola app:** la dueña y la cocina necesitan pantallas chicas y
grandes indistintamente, y mantener tres proyectos separados para un restaurante
es sobre-ingeniería. Expo exporta web con react-native-web, así que los paneles
se abren por URL sin instalar nada.

**Red:** todo corre en la LAN del restaurante. La API y Postgres viven en una
máquina del local (o un mini PC). La tablet se conecta por WiFi. Esto evita que
un corte de internet frene las ventas — pero exige backups locales (ver §8).

---

## 4. Modelo de datos

```
Category        id, nombre, orden, activo
Product         id, categoryId, nombre, descripcion, precioBase, imagenUrl,
                activo, orden, tieneVariantes
ProductVariant  id, productId, nombre ("500ml"), precio, activo, orden
Order           id, numero, fecha, nombreCliente, tipo, estado,
                subtotal, total, paymentQrId,
                creadoEn, pagadoEn, confirmadoPorId, canceladoMotivo
PaymentQr       id, etiqueta, imagenUrl, activo, archivado, creadoEn
OrderItem       id, orderId, productId, variantId?, cantidad, notas,
                nombreSnapshot, precioUnitarioSnapshot
User            id, nombre, rol, pinHash, activo
OrderCounter    fecha (PK), ultimoNumero
AuditLog        id, userId, accion, orderId?, productId?, targetUserId?,
                montoEsperado?, montoRecibido?, detalle (json), creadoEn
Refund          id, orderId, monto, motivo, estado, autorizadoPorId,
                cerradoPorId?, creadoEn, cerradoEn?
PaymentProof    id, orderId, imagenUrl, subidoPorId, creadoEn
Setting         clave (PK), valor (json)
```

### Dinero

Precios en **centavos como entero** (`Int`), nunca `Float`. Bs 45 se guarda como
`4500`. El formateo a `Bs 45` ocurre solo en la UI. Un `Float` acumula error de
redondeo y los totales dejan de cuadrar con el banco — justo lo que no podemos
permitirnos en §5c.

**Todos los montos son múltiplos de 100** (bolivianos enteros, §5b). `total`
iguala a `subtotal`; se mantienen los dos campos para que el cierre pueda
distinguir la venta del ajuste si alguna vez vuelve a haber uno.

### Entidades nuevas

**`Refund`** — una cancelación de pedido pagado no devuelve dinero por sí sola
(§5e, regla 3). Crea una obligación pendiente que una persona cierra cuando
efectivamente devolvió la plata. Sin esta tabla, el cierre presentaría como venta
vigente un dinero que hay que devolver.

**`PaymentProof`** — comprobante del cliente, cargado **solo ante conflicto** por
CAJA o ADMIN (§5f). Es evidencia para una reclamación posterior; **no autoriza la
confirmación de un pago**.

**`AuditLog.targetUserId`** — necesario para auditar operaciones sobre usuarios y
permisos. Otorgar o revocar la capacidad de confirmar cobros es un evento
financiero de la misma categoría que cambiar el QR.

### Detalles que importan

**Snapshot de precios.** `OrderItem` guarda `nombreSnapshot` y
`precioUnitarioSnapshot`. Si la dueña cambia el precio de un plato a mitad del
día, los pedidos ya hechos no se alteran. Sin esto, el reporte de ventas y los
totales históricos se corrompen cada vez que toca un precio.

**Nunca borrar platos.** `activo = false` en lugar de `DELETE`. Un plato borrado
dejaría `OrderItem` huérfanos. El panel muestra "desactivar", no "eliminar".

**Numeración diaria.** `OrderCounter` con una fila por día y un `SELECT ... FOR
UPDATE` dentro de la transacción que crea el pedido. Garantiza números
consecutivos sin huecos ni duplicados. Se reinicia en `#1` cada día a una hora
configurable (ej. 05:00, no medianoche, para no cortar un servicio nocturno).

**Variantes opcionales.** Si `tieneVariantes = false`, el kiosco agrega el plato
al carrito con un toque usando `precioBase`. Si es `true`, muestra los tamaños.
El panel de admin es un switch: "este plato tiene tamaños?" y si se activa,
aparecen las filas de variantes.

---

## 5. Flujo del pedido

```
PENDIENTE_PAGO ──(dueña confirma)──> PAGADO ──(cocina acepta)──> EN_PREPARACION
                                                                      │
      ┌──────────────────────────────────────────────────────────────┘
      ▼
   LISTO ──(cliente retira)──> ENTREGADO

Desde PENDIENTE_PAGO o PAGADO también:  ──> CANCELADO
```

Paso a paso:

1. Cliente arma el carrito en la tablet, escribe su nombre, elige **comer aquí**
   o **para llevar**.
2. Confirma → se crea la orden en `PENDIENTE_PAGO` y recibe su número, `#42`.
3. La tablet muestra el QR de la dueña a pantalla completa, el **monto exacto**
   y el texto "Pedido #42 — mostrale el pago a la cajera".
4. La dueña ve en su panel la cola de pedidos esperando pago, con número, nombre
   y monto. Cuando ve el abono en su app bancaria, toca **Confirmar pago**.
5. La orden pasa a `PAGADO` y se empuja por WebSocket al KDS de cocina.
6. Cocina marca `EN_PREPARACION` y luego `LISTO`.
7. La pantalla de "pedidos listos" muestra `#42 LISTO`.
8. El cliente retira; cocina o caja marca `ENTREGADO`.

---

## 5b. Verificación del pago (el punto crítico del sistema)

El QR estático **no lleva identidad del pedido**. El pago y el pedido solo quedan
vinculados por *(monto, momento)*. De ahí salen los engaños posibles:

| Vector | Cómo funciona | Mitigación |
|---|---|---|
| **Un pago, dos pedidos** | Juan pide `#42` y `#47`, ambos Bs 45. Paga una vez y reclama los dos. | Monto único por pedido (abajo). Dos pedidos nunca comparten monto. |
| **Captura reciclada** | Muestra el screenshot de un pago de ayer o de otro pedido. | No se confirma contra capturas. La dueña confirma contra **su propia app bancaria**, nunca contra la pantalla del cliente. |
| **Pago ajeno** | Llega un pago legítimo de otro cliente por el mismo monto; un tercero lo reclama. | Monto único + ventana de 15 min. Un monto corresponde a un solo pedido abierto. |
| **Confirmación interna** | Una empleada en caja confirma el pedido de un conocido sin pago. | Log de auditoría con usuario, hora y monto. Cuadre de caja al cierre (§5c). |

### La regla que sostiene todo

**La dueña nunca confirma porque el cliente le diga que pagó. Confirma porque vio
el abono en su app bancaria.** Todo el diseño del panel existe para empujarla a
ese hábito. Si el panel es una lista de pedidos con botones verdes, los va a
tocar con la fila de gente mirándola. Por eso el flujo va en la dirección
contraria: **del pago al pedido, no del pedido al pago.**

### Monto único por pedido — DEROGADO

> **Esta regla ya no está vigente.** Decisión del 2026-10-16: todos los precios y
> totales son **bolivianos enteros**, sin centavos. Un recargo de centavos no
> anunciado se percibe como abuso y daña la confianza del cliente.
>
> Lo que se pierde, explícitamente: el sufijo era el mecanismo de emparejamiento
> entre un abono y un pedido. Sin él, dos pedidos abiertos pueden tener el mismo
> total y un abono de ese monto no identifica unívocamente su pedido. Quedan
> abiertos tres de los cuatro vectores de arriba: "un pago, dos pedidos",
> "pago ajeno" y "captura reciclada".
>
> Mitigación adoptada, sin mecanismo criptográfico ni bancario:
> - Nombre del cliente como señal **blanda** (es común pagar desde la cuenta de
>   un familiar). No bloquea por sí sola.
> - Número de pedido y ventana de expiración de 15 minutos.
> - Cola de pendientes visible en el panel.
> - **Desambiguación obligatoria:** cuando haya dos o más pedidos abiertos con el
>   mismo total, el panel los marca como ambiguos y exige elegir por nombre antes
>   de permitir la confirmación. Es el único control estructural que queda contra
>   la confusión de pagos.
> - Auditoría y cuadre diario como control posterior.
>
> Es un **riesgo residual aceptado**, no un problema resuelto. No presentarlo
> como verificación robusta. La salida real sigue siendo el QR dinámico (§5d),
> diferido a v2 por requerir cuenta empresa, NIT y contrato de cobranza.
>
> Impacto en el modelo: `Order.sufijoCentavos` desaparece, `totalACobrar` iguala
> a `subtotal`, y el pool de sufijos sale del alcance de `B8`. Validación nueva:
> rechazar precios que no sean múltiplos de 100 centavos.

**Falla real a cubrir:** con QR estático el cliente **tipea el monto a mano**. Con
montos enteros el error es menos probable, pero sigue existiendo. Dos defensas:
1. La tablet muestra el monto en el tamaño más grande de toda la app.
2. El panel tiene un camino de **"confirmar con diferencia"**: se ingresa el
   monto realmente recibido, el sistema lo compara, y si no coincide registra la
   discrepancia en el log y pide confirmación explícita. **Reservado a ADMIN**:
   CAJA no resuelve diferencias. No se bloquea la venta — se deja rastro.

### El panel de confirmación

El campo de búsqueda por monto tiene el foco por defecto. La dueña ve el abono en
su banco, tipea los últimos dos dígitos, y el pedido aparece.

```
┌──────────────────────────────────────────────┐
│  ¿Cuánto recibiste?                          │
│  ┌──────────────┐                            │
│  │ Bs  45.42    │   ← foco automático        │
│  └──────────────┘                            │
│                                              │
│  ✓ Pedido #42 — Juan                         │
│    2 items · hace 3 min · Bs 45,42           │
│    [ CONFIRMAR PAGO ]                        │
├──────────────────────────────────────────────┤
│  Esperando pago (4)            🔔            │
│  #43  María    Bs 38,43   hace 1 min         │
│  #44  Carlos   Bs 52,44   hace 2 min         │
│  ...                                         │
└──────────────────────────────────────────────┘
```

La cola de abajo le da conciencia de situación, y cada fila también se puede
confirmar directo — pero ese camino abre un diálogo que muestra el monto en
grande y pregunta "¿recibiste Bs 45,42 de este pedido?". Nunca un botón verde
suelto que se toca por reflejo.

La app bancaria muestra el nombre del remitente, así que el nombre del cliente
sirve de señal secundaria. Es **señal blanda**: pagar desde la cuenta de un
familiar es común, así que una diferencia de nombre no bloquea, solo se muestra.

### Gestión de los QR

El QR puede cambiar: la dueña cambia de banco, abre otra cuenta, o quiere cobrar
en una billetera distinta. No va hardcodeado ni se nos pide a nosotros — lo
administra ella desde el panel.

```
PaymentQr   id, etiqueta, imagenUrl, activo, archivado, creadoEn
```

- **Varios QR guardados, uno activo.** La dueña sube los que use y le pone a cada
  uno la etiqueta que quiera, para distinguirlos entre sí. Marca cuál está
  activo y el kiosco siempre muestra ese. Cambiar de QR es un toque, sin
  reiniciar nada: la tablet lo recibe por WebSocket.
- **Subir desde el celular.** Foto o captura desde la galería. El servidor valida
  que sea una imagen y la redimensiona.
- **Nunca se borran, se archivan.** Un QR archivado sigue existiendo porque los
  pedidos viejos apuntan a él. Al borrarlo de verdad perderíamos la trazabilidad
  de a qué cuenta entró cada pago.
- **La imagen de un QR ya usado es inmutable.** Archivar no alcanza: si se
  permite editar la imagen de un `PaymentQr` existente, los pedidos que apuntan
  a él quedan referenciando una imagen que no es la que se mostró, y el cuadre
  por cuenta deja de ser auditable. Una vez que un QR tiene al menos un pedido
  asociado, su `imagenUrl` no se modifica: cambiar la imagen crea una fila nueva
  y archiva la anterior. Editar sigue siendo posible solo mientras el QR no haya
  sido usado en ningún pedido.
- **Cada orden guarda el `paymentQrId` que se le mostró.** Así el cuadre de cierre
  (§5c) puede separar los totales por cuenta — indispensable si cambió de QR a
  media jornada, porque si no el cuadre nunca da.
- **Nunca cero QR activos.** Si la dueña archiva el único activo, el sistema se
  lo impide y le explica por qué: el kiosco no podría cobrar y las ventas se
  detienen. El panel muestra una alerta si no hay QR activo.
- **Cambio de QR en el log de auditoría.** Es un evento financiero: cambia la
  cuenta a la que entra el dinero.

**Decisión intencional:** no leemos ni validamos el contenido del QR. Podríamos
decodificarlo para verificar a qué cuenta apunta, pero los formatos de QR Simple
varían por banco y una validación a medias rechazaría QR legítimos — peor que no
validar. Mostramos la imagen tal cual y la dueña es responsable de subir la
correcta. La `etiqueta` es texto libre suyo, solo para que los distinga en el
panel; el sistema no la interpreta.

### Carritos abandonados

Alguien pide, no paga y se va. Un job cancela las órdenes en `PENDIENTE_PAGO`
después de 15 minutos (configurable) y **libera el sufijo de centavos** al pool.
Sin esto la cola se llena de basura y el pool se agota.

### La dueña es el cuello de botella

Si está ocupada, la cocina no recibe nada. El panel necesita ser ruidoso: sonido
al entrar un pedido, contador grande, badge en el título de la pestaña, y un
aviso en el KDS de cocina de "N pedidos esperando pago" para que sepan por qué
no les llega trabajo.

---

## 5c. Controles de cierre

**Log de auditoría.** Cada confirmación registra quién, cuándo, monto esperado,
monto ingresado y si hubo discrepancia. Lo mismo para cancelaciones y cambios de
precio. Es lo único que permite reconstruir qué pasó si al cierre no cuadra —
y es la defensa contra confirmaciones internas sin pago.

**Cuadre diario.** Un reporte al cierre: total de pedidos confirmados vs. total
que debería haber entrado a la cuenta. La dueña compara ese número con el
movimiento de su banco. Si no cuadra, el log dice qué pedido y quién lo confirmó.
Este reporte es lo que convierte el log en algo útil en lugar de datos muertos.

---

## 5d. La salida real: QR dinámico — DIFERIDO A v2

Todo lo de arriba es mitigación de una limitación que **se puede eliminar**.

Bolivia tiene QR Simple, el estándar interoperable de ASFI, y los bancos ofrecen
servicios de cobranza por QR para cuentas empresa: la API genera un QR por pedido
con el monto ya embebido, y el banco notifica el pago por webhook. Con eso:

- El monto no se tipea → se elimina el error de centavos
- El pago llega atado al pedido → se eliminan **los cuatro vectores de engaño**
- La dueña deja de ser el cuello de botella → el pedido entra a cocina solo

Requiere cuenta empresa y contrato con el banco, probablemente con comisión por
transacción. **Vale la pena que la dueña lo pregunte en su banco antes de que
avancemos mucho** — no sé las condiciones comerciales actuales de cada banco
boliviano y eso hay que averiguarlo de primera mano.

El diseño deja la puerta abierta: el pago vive detrás de una interfaz
`PaymentProvider` con dos implementaciones, `QrEstaticoManual` y
`QrDinamicoWebhook`. Cambiar de una a otra no toca el kiosco, ni la cocina, ni el
catálogo. Solo aparece (o desaparece) la pantalla de confirmación de la dueña.

**Estado: fuera del MVP.** Decisión del 2026-10-16: no hay cuenta empresa ni NIT,
y obtenerlos es un trámite que no vamos a esperar. El MVP se construye solo con
`QrEstaticoManual`. La interfaz `PaymentProvider` se mantiene como frontera de
diseño, pero **no se implementa una segunda estrategia ni infraestructura de
webhooks**. No declarar soporte de QR dinámico como capacidad del sistema.

Advertencia sobre lo de arriba: la afirmación de que elimina "los cuatro vectores
de engaño" no está demostrada. Depende del contrato bancario, de la autenticación
de los webhooks, de la idempotencia de las notificaciones, de la conciliación y
de la gestión de devoluciones. Es la dirección correcta, no una garantía.

---

## 5e. Políticas financieras

Cada una es una situación que va a ocurrir. Sin una regla decidida, cada persona
resuelve distinto y el cierre no cuadra.

**Estado: propuestas, pendientes de aprobación de la dueña.** Ver
`PREGUNTAS_PARA_LA_DUENA.txt`.

1. **Pago insuficiente.** Diferencia de hasta Bs 2: CAJA confirma y queda en
   auditoría. Más de Bs 2: solo ADMIN autoriza. El cliente no retira hasta
   completar o hasta autorización expresa.
2. **Pago en exceso.** Se devuelve de caja chica y se registra. Sin efectivo
   disponible, decide ADMIN.
3. **Cancelación de pedido pagado.** Solo ADMIN. Motivo obligatorio. Crea un
   `Refund` en estado pendiente que se cierra manualmente al devolver el dinero.
   **Cancelar no es reembolsar:** el sistema recuerda la deuda, no mueve plata.
4. **Pago tardío tras la expiración.** El pedido no se revive. Se crea uno nuevo
   o queda como `Refund` pendiente.
5. **Definición de jornada.** Corte a las 05:00. Un pedido pertenece a la jornada
   en que fue **pagado**, no en que fue creado.
6. **Contenido del cierre.** Cuatro cifras separadas, nunca un total único:
   ventas confirmadas, monto esperado en cuenta, devoluciones pendientes y
   confirmaciones con diferencia. Más desglose **por operador**: con dos personas
   confirmando, la dueña necesita saber quién confirmó qué.
7. **Plato pagado no preparable.** Cocina avisa; se ofrece sustitución de igual
   precio o devolución según la regla 3.

---

## 5f. Comprobante del cliente — evidencia, no autorización

Se evaluó pedirle al cliente que suba la captura de su pago. **Decisión: no
exigirlo en el flujo normal.**

Dos razones. La primera, operativa: el comprobante está en el teléfono del
cliente y el kiosco no puede acceder a su galería. La segunda, y la que decide:
un comprobante en pantalla en cada pedido desplaza la verificación hacia la
captura y lejos del extracto bancario, porque es más rápido y está a mano. El
comprobante obligatorio **degrada** el control en lugar de reforzarlo, y
contradice la regla central de §5b.

Alcance adoptado: carga **solo ante conflicto**, iniciada por CAJA o ADMIN desde
el panel, fotografiando la pantalla del cliente. Queda asociada al pedido
(`PaymentProof`) y a su auditoría. Sirve como prueba para una reclamación
posterior; **no habilita la confirmación**.

Descartado por incompatibilidad con la arquitectura: QR en el kiosco para que el
cliente suba la imagen desde su teléfono. El servidor vive en la LAN (§3) y el
teléfono del cliente está en datos móviles; resolverlo exigiría WiFi para
invitados o exponer la API a internet, ampliando la superficie de ataque sin
necesidad.

Pendiente: período de retención de esas imágenes (son datos de terceros).

---

## 5g. Roles y quién hace qué

Tres roles con login más el kiosco sin login.

| Acción | KIOSCO | COCINA | CAJA | ADMIN |
|---|---|---|---|---|
| Consultar catálogo | Sí | Sí | Sí | Sí |
| Crear pedido | Sí | No | Sí | Sí |
| Confirmar pago de monto coincidente | No | No | **Sí** | Sí |
| Confirmar con diferencia | No | No | No | Sí |
| Cancelar pedido pagado | No | No | No | Sí |
| Avanzar preparación / LISTO | No | Sí | No | No |
| Marcar ENTREGADO | No | Sí | Sí | Sí |
| Adjuntar comprobante de conflicto | No | No | Sí | Sí |
| Cerrar un `Refund` | No | No | No | Sí |
| Gestionar catálogo y precios | No | No | No | Sí |
| Gestionar QR de cobro | No | No | No | Sí |
| Ver cuadre de cierre | No | No | No | Sí |
| Ver log de auditoría | No | No | No | Sí |
| Crear usuarios y asignar roles | No | No | No | Sí |

**Autorización en el servidor, no en la UI.** Ocultar un botón no es un permiso.

### Cómo verifica CAJA

El sistema no recibe ninguna señal del banco: con QR estático, la única fuente de
verdad sobre un pago es el extracto de la cuenta. Verificar es, necesariamente,
mirar el banco.

**Solución:** un celular del negocio queda en el local con la banca móvil de la
dueña abierta. CAJA consulta los abonos ahí. Ese celular está **fuera del
sistema** — no es un componente de software, no requiere desarrollo y no aparece
en el modelo de datos. Es un activo físico del local, como la tablet.

Flujo de CAJA:
1. El cliente confirma su pedido en el kiosco → `PENDIENTE_PAGO`, monto entero.
2. Paga escaneando el QR estático desde su propia app bancaria.
3. CAJA observa el abono en el celular del negocio.
4. Localiza el pedido en el panel por monto y nombre, y lo contrasta.
5. Confirma. `AuditLog` persiste **su** `userId`, no el de la dueña.
6. El pedido pasa a `PAGADO` y entra a cocina.

Monto no coincidente o pedido ausente del extracto → deriva a ADMIN. CAJA no
resuelve diferencias.

**Riesgo que el sistema no puede mitigar:** una app de banca móvil ya autenticada
normalmente permite transferir. "La cajera no puede mover plata" no está
garantizado por el software — depende de si el banco exige credencial por
operación. Controles, todos fuera del sistema: verificar si transferir pide clave
de nuevo; si no la pide, usar una cuenta dedicada a cobros con saldo bajo barrida
al cierre; preferir un acceso de solo consulta si el banco lo ofrece; acordar con
la empleada la responsabilidad por faltantes antes de operar.

### Dispositivos

| Superficie | Dispositivo | Login |
|---|---|---|
| `/kiosk` | Tablet fija en la entrada, modo kiosco Android | Sin login; token de dispositivo |
| `/kds` | Navegador en cocina | PIN 4+ dígitos, rol COCINA |
| `/admin` | Laptop o celular de CAJA; celular o PC de ADMIN | PIN 6 dígitos |

La tablet del kiosco **no la opera el personal**. CAJA confirma desde su propio
dispositivo entrando a `/admin` por navegador en la LAN, sin instalar nada. Así
ADMIN y CAJA no comparten pantalla y no hay observación mutua del PIN.

Si CAJA usa un dispositivo personal, conserva la sesión del navegador al
desvincularse del negocio. Por eso la revocación debe surtir efecto en el
servidor de inmediato: **validar estado y rol contra la base en cada petición**,
no confiar en la expiración del JWT.

---

## 6. API REST

```
# Público (kiosco, sin auth — token de dispositivo)
GET    /catalog                      categorías + platos activos + variantes
POST   /orders                       crea pedido → devuelve número y total
GET    /orders/:id                   estado del pedido (para la pantalla de espera)
GET    /orders/ready                 pedidos listos (pantalla pública)

# CAJA + ADMIN
GET    /admin/orders?estado=         cola de pedidos, filtrable
POST   /admin/orders/:id/confirm-payment      monto coincidente
POST   /admin/orders/:id/deliver              marca ENTREGADO
POST   /admin/orders/:id/proof                sube comprobante de conflicto

# Solo ADMIN
POST   /admin/orders/:id/confirm-with-difference
POST   /admin/orders/:id/cancel
GET    /admin/refunds                lista de devoluciones pendientes
POST   /admin/refunds/:id/settle     cierra una devolución ya entregada
CRUD   /admin/categories
CRUD   /admin/products               incluye activar/desactivar y reordenar
CRUD   /admin/products/:id/variants
GET    /admin/qrs                    lista de QR guardados
POST   /admin/qrs                    sube un QR nuevo (multipart)
POST   /admin/qrs/:id/activate       lo vuelve el activo del kiosco
POST   /admin/qrs/:id/archive        archiva (rechaza si es el único activo)
CRUD   /admin/users                  altas, rol, desactivación, reseteo de PIN
GET    /admin/reports/daily          ventas del día, platos más vendidos
GET    /admin/reports/closing        cuadre de cierre, por QR y por operador
GET    /admin/audit                  log de auditoría, filtrable
GET/PUT /admin/settings              horario de corte, timeout de pago

# COCINA
GET    /kitchen/orders               pedidos PAGADO / EN_PREPARACION / LISTO
POST   /kitchen/orders/:id/status    avanza el estado

# Auth
POST   /auth/login                   PIN → JWT
```

**WebSocket** (`/ws`, namespaces por rol): `order.created`, `order.paid`,
`order.status_changed`, `catalog.updated`, `qr.changed`. La cocina y el panel de
la dueña se actualizan sin recargar, y la tablet cambia de QR al instante.

**Auth por PIN.** Login con un PIN de números, no email y contraseña — es lo que
funciona con las manos ocupadas y una tablet grasosa. Además, el servidor vive en
la LAN (§3): recuperar una contraseña por correo sería inoperable en un corte de
internet, mientras que resetear un PIN desde `/admin/users` no depende de nada
externo.

- **6 dígitos** para roles que confirman pagos (ADMIN, CAJA). 4 admisibles para
  COCINA.
- Un PIN **por persona**, nunca compartido. Sin PIN individual el log de
  auditoría no puede atribuir una confirmación a nadie, y deja de ser prueba.
- Hasheado con argon2, sin almacenamiento reversible: ni el programador puede
  leer el PIN de la dueña. Si se olvida, se asigna uno nuevo.
- Rate limit estricto en el login, **desde el primer sprint**. Un PIN de 6
  dígitos son un millón de combinaciones, pero sin límite de intentos un script
  las prueba igual. Es el control que hace suficiente al PIN.
- El guard valida **estado y rol contra la base en cada petición**, no solo el
  contenido del JWT. Es lo que hace que revocar un permiso surta efecto en el
  momento y no cuando expire el token.

Qué protege el PIN, para que no se subestime: no protege la cuenta bancaria —
protege el botón de confirmar un pago. Un PIN comprometido permite marcar como
pagado un pedido que nadie pagó, y la pérdida sale en comida de la cocina.

**Validación.** Zod en `packages/shared`, reusado por la API y el cliente. El
total **se recalcula siempre en el servidor** desde los precios de la base —
nunca se confía en el total que manda la tablet. Se rechazan precios que no sean
múltiplos de 100 centavos (§5b).

---

## 7. UI — criterios de diseño

### Kiosco (lo más importante del proyecto)

La usa gente apurada, de pie, que nunca vio el sistema y no va a recibir
instrucciones. Reglas:

- **Botones grandes.** Mínimo 64×64 px de área táctil, 72 px para acciones
  principales. Nada de iconos chicos ni menús desplegables.
- **Tres toques para pedir.** Categoría → plato → agregar. Nada más.
- **Fotos de los platos.** En un kiosco la foto vende más que el nombre. Grid de
  tarjetas con imagen, nombre y precio visibles sin tocar nada.
- **Carrito siempre visible.** Columna fija a la derecha con los items, el total
  en grande y un botón de confirmar que no se esconde al hacer scroll.
- **Cantidad con + y −.** Sin teclados numéricos ni campos de texto.
- **Un solo campo de texto en todo el flujo:** el nombre. Teclado en pantalla
  grande, y el nombre es opcionalmente salteable (queda solo el número).
- **Auto-reset.** Si nadie toca la pantalla por 60 s con un carrito a medias,
  vuelve al inicio y lo descarta. Si no, el carrito del cliente anterior se
  mezcla con el del siguiente.
- **Contraste alto y texto grande.** Mínimo 18 px de cuerpo, 24 px en precios.
  La tablet va a estar en la entrada, con luz del sol de costado.
- **Cero jerga.** "Para llevar" y "Comer aquí", no "takeaway" / "dine-in".
- **Pantalla de pago inequívoca.** QR enorme, monto en el tamaño más grande de
  toda la app, número de pedido al lado. Es el momento donde más se confunde la
  gente.

### Panel de la dueña

Tres trabajos distintos, tres pestañas.

**Pestaña 1 — Pagos.** Diseñada en §5b: buscador por monto con foco automático,
cola de pedidos esperando debajo. Es la pantalla que mira todo el día.

**Pestaña 2 — Menú.** La dueña gestiona su carta sola, sin pedirnos nada. Es
requisito, no opcional, así que tiene que aguantar a alguien sin práctica técnica
usándola desde el celular:

- **Lista de platos con el precio editable en la misma fila.** Tocar el precio,
  tipear, guardar. No abrir un formulario de ocho campos para cambiar Bs 2.
- **Switch de activo/inactivo por plato,** visible en la lista. Es la acción más
  frecuente del día (se acabó el pollo → se desactiva) y necesita un solo toque.
- **Nunca un botón de "eliminar"** junto a los demás. Desactivar es lo que ella
  quiere el 99% de las veces. Borrar un plato rompería los pedidos históricos
  (§4), así que el borrado real no existe: solo se archiva, y detrás de una
  confirmación aparte.
- **Fotos desde la galería o la cámara del celular.** Se suben y se redimensionan
  en el servidor. Si un plato no tiene foto, se muestra una tarjeta con el nombre
  en grande — nunca un ícono de imagen rota.
- **Reordenar arrastrando.** El orden del menú es decisión comercial suya (lo que
  quiere vender va primero).
- **Cambios en vivo.** Al guardar, la tablet actualiza el catálogo por WebSocket
  sin reiniciarse. Un plato desactivado desaparece del kiosco al instante — pero
  los carritos a medio armar que ya lo tenían se avisan al confirmar, no se
  vacían de golpe.
- **Cada cambio de precio queda en el log de auditoría** (§5c), para poder
  explicar un cierre que no cuadra.

**Pestaña 3 — Cobro.** Sus QR en tarjetas con la imagen visible y el activo
destacado. Subir uno nuevo, activar otro, archivar (§5b). Debajo, el cuadre del
día desglosado por QR. Es la pestaña que menos visita, pero cuando la necesita
—cambió de banco a media jornada— tiene que resolverlo sin llamarnos.

### KDS cocina
Tarjetas en columnas por estado, letra grande legible a un metro de distancia,
y el tiempo transcurrido desde que entró el pedido en cada tarjeta (pasa a rojo
después de X minutos). Sin scroll horizontal. Tocar la tarjeta avanza el estado.

---

## 8. Riesgos operativos

| Riesgo | Mitigación |
|---|---|
| Se corta la luz o el servidor | Postgres local + `pg_dump` automático diario a un pendrive o a la nube. Sin backup, un disco muerto borra el menú y el historial. |
| Se cae el WiFi | La tablet muestra un cartel claro de "sin conexión" y bloquea el envío. No encolar pedidos localmente en fase 1: el riesgo de pedidos duplicados o perdidos es peor que el de no vender 5 minutos. |
| Alguien sale de la app en la tablet | Android en modo kiosco (screen pinning o un launcher dedicado), sin barra de navegación. |
| La dueña no confirma y la cocina espera | Sonido + contador en el panel, y un aviso en el KDS de "N pedidos esperando pago". |
| Se preparó comida no pagada | El estado `PENDIENTE_PAGO` nunca llega a cocina. Es el punto de todo el diseño. |
| El cliente dice que pagó y no pagó | La dueña solo confirma contra lo que ve en su app bancaria. El sistema no es la fuente de verdad del pago. |

---

## 9. Fases de construcción

> Las fases quedan como vista conceptual. **La planificación ejecutable vive en
> `MODULOS.md` (módulos y sprints) y en `docs/sprints/` (requerimientos por
> sprint).** Esta sección no se usa para asignar trabajo.

**Fase 0 — Cimientos.** Monorepo, `docker-compose` con Postgres, esquema Prisma,
migraciones, seed con un menú de ejemplo, `packages/shared` con tipos y la
máquina de estados.

**Fase 1 — API.** Auth por PIN con rate limit, gestión de usuarios, CRUD de
catálogo, creación de pedidos con numeración transaccional, recálculo de total,
máquina de estados con transiciones validadas, WebSockets, job de cancelación
por timeout.

**Fase 2 — Kiosco.** Catálogo con fotos, carrito, nombre, comer aquí/llevar,
pantalla de pago con el QR activo y el monto en grande, pantalla de espera con el
número, auto-reset.

**Fase 3 — Panel de cobro.** Buscador de confirmación por monto (la pantalla
crítica) con desambiguación de montos iguales, gestión de QR, CRUD de platos y
categorías, activar/desactivar, precios, reordenar.

**Fase 4 — KDS cocina.** Tablero en tiempo real, avance de estados, tiempos.

**Fase 5 — Cierre.** Pantalla pública de pedidos listos, reporte del día, cuadre
por QR y por operador, devoluciones pendientes, vista del log de auditoría,
configuración.

**Fase 6 — Endurecimiento.** Modo kiosco en Android, pruebas en el local real.

Nota: backups y rate limit **ya no van en esta fase**. Son requisito para operar
con dinero real y se adelantan (ver `MODULOS.md`).

---

## 10. Pendientes

### Resueltos
- País y moneda → **Bolivia, bolivianos enteros**, centavos como entero interno
- Hardware → **PC en el local** como servidor, tablet en la entrada para pedir
- Gestión del menú → **la dueña lo administra ella misma** desde el panel (§7)
- Monto único → **derogado.** Precios enteros, con desambiguación por nombre (§5b)
- El QR → **gestionable desde el panel**, varios guardados y uno activo (§5b).
  La imagen de un QR ya usado es inmutable.
- Rol `CAJA` → **aprobado** (§5g). Confirma pagos de monto coincidente; no
  resuelve diferencias ni cancela.
- Cómo verifica CAJA → **celular del negocio** con la banca móvil de la dueña,
  fuera del sistema (§5g)
- Comprobante del cliente → **solo ante conflicto**, como evidencia (§5f)
- Integración bancaria / QR dinámico → **fuera del MVP** (§5d)
- Login → **PIN**, 6 dígitos para quien confirma pagos, rate limit desde S1 (§6)
- Auditoría financiera → se escribe **dentro de la transacción**
  (`ARQUITECTURA §3`)

### Bloquean el desarrollo de pedidos y pagos
Son decisiones de la dueña. Ver `PREGUNTAS_PARA_LA_DUENA.txt`.

1. **Acceso de consulta bancaria para CAJA** (preguntas 1, 2, 3). Sin un sí, el
   rol no es viable y el cuello de botella se queda.
2. **Las siete políticas financieras** de §5e, en especial la tolerancia de
   diferencia y el tratamiento de las devoluciones.
3. **Pago tardío** tras la expiración (regla 4 de §5e).

Los cimientos (`B1`–`B4`, `B6`, `F1`) no dependen de ninguna de estas respuestas
y pueden construirse en paralelo.

### Decisiones de UI todavía abiertas
- Liberación de la tablet entre clientes: el auto-reset de 60 s cubre el carrito
  a medias, pero no la pantalla de espera. Requisito de `F3`.
- Plato pagado que cocina no puede preparar: la regla 7 de §5e lo resuelve en lo
  operativo; falta el flujo en el sistema.
- Retención de las imágenes de comprobantes (§5f).

### A consultar en paralelo
1. **QR dinámico con el banco** (§5d). Para v2, no para ahora: requiere cuenta
   empresa y NIT. Que la dueña averigüe costo y requisitos cuando pueda.
2. **Especificaciones del PC** que hará de servidor (SO, RAM) y si el WiFi del
   local llega bien a la entrada.
3. **Modelo de la tablet** y su versión de Android, para el modo kiosco.
4. **Impresora térmica.** ¿Hay una? Define si cocina imprime ticket o solo mira
   pantalla.
5. **Horario de corte** para reiniciar la numeración diaria (propuesto: 05:00,
   regla 5 de §5e).
6. **Menú inicial** para el seed de desarrollo. No hace falta el definitivo —
   la dueña lo gestiona después — pero sirven 10-15 platos reales con precios
   para probar con datos creíbles.
7. **¿Hay alguien más en caja además de la dueña?** Define si el rol `CAJA`
   existe separado de `ADMIN`. Importa para el log de auditoría: si otra persona
   confirma pagos, el registro de quién confirmó qué es lo único que protege a
   la dueña.
