# S6 — Kiosco

**Módulos:** F2 `kiosco — catálogo y carrito`, F3 `kiosco — checkout y pago`
**Estimación:** 10 jornadas compartidas entre F2 y F3 (`MODULOS §1`: son un solo
flujo partido en dos entregas, no dos estimaciones que se suman)
**Estado:** **PARCIAL.** Bloqueado por `H08` — liberación de la tablet entre
clientes. Es una decisión de UI pendiente y es requisito de F3.

---

## Objetivo

Que un cliente que nunca vio el sistema pueda pedir solo, de pie y apurado:
catálogo con fotos, carrito, nombre, comer aquí o para llevar, y una pantalla de
pago con el QR activo y el monto en grande.

Al cerrar S6 el pedido se crea de verdad en `PENDIENTE_PAGO`. Nadie lo confirma
todavía: eso es S7.

---

## F2 — `kiosco — catálogo y carrito`

Parte de las 10 jornadas compartidas con F3. Fuente: `PLAN §7` (criterios del
kiosco), `PLAN §4` (variantes opcionales), `ARQUITECTURA §7` (frontend),
`REPORTE CLI-01`, `REPORTE CLI-02`.

El kiosco es lo más importante del proyecto porque es la única superficie que usa
gente sin entrenamiento y sin nadie al lado que le explique (`PLAN §7`).

### RQ-601 — Área táctil mínima

Fuente: `PLAN §7`.

- Mínimo **64×64 px** de área táctil en cualquier elemento tocable.
- **72 px** para las acciones principales: agregar al carrito, confirmar,
  siguiente.
- Prohibido: iconos chicos como único blanco de toque, menús desplegables.

Aceptación: no existe en `/kiosk` ningún elemento interactivo por debajo de
64×64 px de área táctil, incluido el padding.

### RQ-602 — Tres toques para pedir

Fuente: `PLAN §7`.

Categoría → plato → agregar. Nada más entre el inicio y tener el primer item en
el carrito.

Para un plato con `tieneVariantes = true` se agrega un paso de elección de tamaño
(`PLAN §4`). Para `tieneVariantes = false` se agrega con un solo toque usando
`precioBase`.

Aceptación: se cuenta la cantidad de toques desde la pantalla inicial hasta tener
un plato simple en el carrito, y son tres.

### RQ-603 — Grid de tarjetas con foto

Fuente: `PLAN §7`, `REPORTE CLI-01`.

- Grid de tarjetas con **imagen, nombre y precio visibles sin tocar nada**. En un
  kiosco la foto vende más que el nombre (`PLAN §7`).
- Plato sin foto: tarjeta con el nombre en grande. **Nunca un ícono de imagen
  rota** (`PLAN §7`, pestaña Menú).
- Solo platos activos y sus variantes activas. Un plato desactivado desaparece
  del menú (`REPORTE CLI-01`).

Pendiente de decisión (`REPORTE CLI-01`): comportamiento de categorías inactivas,
de variantes desactivadas y de una categoría sin productos. Pregunta que lo
desbloquea: ¿una categoría sin platos vendibles se oculta o se muestra vacía?

### RQ-604 — Carrito siempre visible

Fuente: `PLAN §7`.

- Columna fija a la derecha con los items.
- Total en grande.
- Botón de confirmar que **no se esconde al hacer scroll**.

### RQ-605 — Cantidad con + y −

Fuente: `PLAN §7`.

Sin teclados numéricos, sin campos de texto para la cantidad.

Aceptación: la cantidad de un item solo se puede cambiar con los botones + y −, y
el servidor rechaza cantidades inválidas (`REPORTE CLI-02`).

### RQ-606 — Notas libres por item

Fuente: `PLAN §2`, `PLAN §4` (`OrderItem.notas`), `REPORTE CLI-02`.

Las notas son texto libre por item. **No son un catálogo de modificadores** y no
tienen costo (`PLAN §2`, fuera de alcance: añadidos con costo).

Pendiente de decisión (`REPORTE CLI-02`): límite de longitud del texto, y si una
nota del tipo "sin maní" es aceptable y cómo se advierte que no garantiza
ausencia de alérgenos. Pregunta que lo desbloquea: ¿cocina se compromete a
cumplir las notas, o son una preferencia sin garantía?

Nota de interacción: RQ-611 fija que el nombre es el único campo de texto del
flujo. Mientras las notas sigan en alcance, el teclado aparece también acá; la
regla de `PLAN §7` se refiere al flujo obligatorio de checkout, no a una acción
opcional por item. Si al probar con gente real (O4) las notas resultan ruido, es
el primer candidato a recorte.

### RQ-607 — Contraste alto y texto grande

Fuente: `PLAN §7`.

- Cuerpo de texto: mínimo **18 px**.
- Precios: mínimo **24 px**.
- Contraste alto: la tablet está en la entrada, con luz del sol de costado.

### RQ-608 — Cero jerga

Fuente: `PLAN §7`.

"Para llevar" y "Comer aquí". No "takeaway" ni "dine-in". La misma regla aplica a
todo texto visible del kiosco: nada de "checkout", "orden" en lugar de "pedido",
ni mensajes de error técnicos.

### RQ-609 — Catálogo en vivo por WebSocket

Fuente: `PLAN §7` (pestaña Menú, "cambios en vivo"), `PLAN §6` (evento
`catalog.updated`), `REPORTE CLI-01`.

- La tablet recibe `catalog.updated` y refresca el catálogo sin reiniciarse.
- Un plato desactivado desaparece del kiosco al instante.
- **Los carritos a medio armar no se vacían de golpe:** se avisa al confirmar
  (`PLAN §7`). Vaciar el carrito en silencio delante del cliente es peor que el
  aviso.

Aceptación: desactivar un plato desde el panel lo quita del grid sin recargar la
app, y un carrito que ya lo tenía recibe aviso al confirmar, no antes.

### RQ-610 — Una sola capa de acceso a red

Fuente: `ARQUITECTURA §7`.

`apiClient` único con reintentos, timeout y detección de offline. Si cada pantalla
hace su propio `fetch`, el manejo de "se cayó el WiFi" queda inconsistente y la
tablet se cuelga en silencio justo cuando hay gente esperando.

Este módulo ya existe como F1 (S2). Acá se consume, no se reescribe.

---

## F3 — `kiosco — checkout y pago`

Resto de las 10 jornadas compartidas. Fuente: `PLAN §5` (flujo), `PLAN §7`,
`ARQUITECTURA §7` (idempotencia), `REPORTE CLI-03`, `REPORTE CLI-04`,
`REPORTE CLI-05`.

### RQ-611 — Un solo campo de texto en todo el flujo

Fuente: `PLAN §7`.

El nombre del cliente es el único campo de texto del checkout, con teclado en
pantalla grande.

Contradicción documentada, pendiente de decisión (`REPORTE CLI-03`): `PLAN §5`
dice que el cliente "escribe su nombre" y `PLAN §7` dice que el nombre es
"opcionalmente salteable (queda solo el número)". Hay que decidir una sola regla.
Pregunta que lo desbloquea: ¿el nombre es obligatorio? (`REPORTE §11`, pregunta
9).

Esto no es un detalle cosmético: el nombre es la señal de desambiguación de R-01
en el panel de cobro (`PLAN §5b`, D-04). Un pedido sin nombre no se puede
desambiguar cuando hay dos montos iguales abiertos. Hasta que la dueña decida, F3
se construye con el nombre **obligatorio**, que es el caso que no deja al panel
sin señal, y se deja la regla aislada en un solo lugar.

### RQ-612 — Comer aquí o para llevar

Fuente: `PLAN §5`, `PLAN §7`.

Dos botones grandes con el texto de RQ-608. Es parte de `Order.tipo` (`PLAN §4`) y
cocina lo necesita ver en la tarjeta del KDS.

### RQ-613 — Creación de pedido idempotente

Fuente: `ARQUITECTURA §7`, `ARQUITECTURA §9` (decisión 7), `REPORTE CLI-03`,
`REPORTE V05`.

- El cliente genera un **UUID de intento** y lo manda en el `POST /orders`.
- Si la respuesta se pierde por WiFi y la tablet reintenta con el mismo UUID, el
  servidor **devuelve el pedido ya creado** en lugar de crear un segundo.
- El UUID se genera una vez por intento de checkout, no por reintento.

Por qué: el WiFi se va a caer (`ARQUITECTURA §9`). Sin idempotencia, un WiFi
inestable genera pedidos duplicados, y un duplicado en `PENDIENTE_PAGO` empeora
directamente R-01, porque agrega otro pedido abierto con el mismo total.

El lado servidor es B7 (S3). Acá va la generación y el envío del UUID, y el
manejo de la respuesta repetida.

Aceptación: reintentar el mismo `POST` con el mismo UUID devuelve el mismo
`numero` de pedido y no crea una segunda fila.

### RQ-614 — El total que se muestra no es el total que se cobra

Fuente: `ARQUITECTURA §6`, `PLAN §6`, `REPORTE CLI-03`.

El cliente usa `Money` para **mostrar** el total, nunca para decidirlo. El total
se recalcula siempre en el servidor desde los precios de la base.

Si el servidor devuelve un total distinto del que mostraba el carrito (porque la
dueña cambió un precio o desactivó un plato), se avisa y se pide aceptación
explícita antes de crear el pedido. **No se vacía el carrito en silencio**
(`REPORTE CLI-03`, `REPORTE V03`, `V04`).

Pendiente de decisión (`REPORTE CLI-03`): la política exacta de aceptación del
precio nuevo. Pregunta que lo desbloquea: si el precio subió mientras el cliente
armaba el carrito, ¿se cobra el nuevo con aviso, o se honra el que vio?

### RQ-615 — Pantalla de pago inequívoca

Fuente: `PLAN §7`, `PLAN §5`, D-04.

Es el momento donde más se confunde la gente (`PLAN §7`). Contenido:

- **QR enorme** — la imagen del `PaymentQr` activo, a pantalla completa.
- **Monto en el tamaño más grande de toda la app.** Es un **boliviano entero**:
  `Bs 45`. No hay sufijo de centavos ni centavos resaltados — D-04 lo derogó. Lo
  que se resalta es el número completo, porque el cliente lo tipea a mano en su
  app bancaria (`PLAN §5b`, "falla real a cubrir").
- **Número de pedido** al lado, legible.
- Texto llano indicando que el pago se verifica en el local.

Aceptación: ningún texto de la aplicación tiene un tamaño de fuente mayor que el
del monto en esta pantalla.

### RQ-616 — El QR mostrado queda atado al pedido

Fuente: `PLAN §5b` ("cada orden guarda el `paymentQrId` que se le mostró"),
`REPORTE CLI-04` (propuesta de control), `REPORTE V13`, D-08.

Si la dueña activa otro QR mientras un cliente está pagando, el pedido ya creado
**conserva el QR que se le mostró**. El cambio afecta a los pedidos nuevos, no
redirige uno en curso.

En el kiosco esto significa: la pantalla de pago de un pedido existente no se
actualiza con `qr.changed`; solo el estado inicial del kiosco toma el QR activo
nuevo.

Aceptación: emitir `qr.changed` con una pantalla de pago abierta no cambia la
imagen que ese cliente está viendo.

### RQ-617 — Pantalla de espera con el número

Fuente: `PLAN §5` (paso 3 y 7), `PLAN §6` (`GET /orders/:id`),
`REPORTE CLI-05`.

Después de crear el pedido, la tablet muestra el número y el estado. Consulta
`GET /orders/:id`.

Pendiente de decisión (`REPORTE §11`, pregunta 14, y `REPORTE CLI-05`): qué
información puede consultar el cliente fuera del kiosco y cómo conserva su número
sin impresora. La pantalla pública de números listos es F8 (S9).

### RQ-618 — Auto-reset a los 60 segundos

Fuente: `PLAN §7`.

Si nadie toca la pantalla por **60 segundos con un carrito a medias**, vuelve al
inicio y lo descarta. Si no, el carrito del cliente anterior se mezcla con el del
siguiente (`PLAN §7`, `REPORTE V18`).

Aceptación: con items en el carrito y sin toques por 60 s, la app vuelve a la
pantalla inicial con el carrito vacío.

Pendiente de decisión (`REPORTE CLI-02`): si hay confirmación antes del reinicio
o se descarta sin preguntar.

### RQ-619 — Liberación de la tablet entre clientes — PENDIENTE DE DECISIÓN

Fuente: `REPORTE H08`, `PLAN §10` ("Decisiones de UI todavía abiertas"),
`docs/README.md` (pendientes técnicos propios).

**Este requerimiento bloquea el cierre de F3 y es la razón por la que S6 está en
estado PARCIAL.**

Lo que está resuelto: el auto-reset de 60 s de RQ-618 cubre el **carrito a
medias**.

Lo que no está resuelto: la **pantalla de espera**. Un cliente que ya confirmó su
pedido deja la tablet mostrando su número y, eventualmente, su nombre. El
siguiente cliente llega y encuentra la pantalla ocupada con datos de otra persona.
`H08` lo dice literal: el reinicio por inactividad descrito corresponde a carrito
incompleto y no resuelve todos los estados.

Las tres cosas que hay que decidir, y no las decide el desarrollo:

1. **Cuánto dura la pantalla de espera antes de liberar la tablet.** Un
   temporizador distinto del de RQ-618, porque acá no hay nada que descartar: el
   pedido ya existe en la base.
2. **Cómo se lleva el cliente su número.** No hay impresora confirmada
   (`REPORTE §11`, pregunta 14). Si la tablet se libera, el cliente se queda con
   el número en la memoria.
3. **Qué datos del cliente anterior pueden quedar en pantalla.** `REPORTE V18`
   exige que el segundo cliente no herede datos, carrito ni pago del anterior.

Pregunta que lo desbloquea, para la dueña: cuando un cliente termina de pedir,
¿quiere que la tablet se libere sola a los pocos segundos, o que una persona del
local la libere con un toque? Y: ¿hay o va a haber impresora térmica?
(`REPORTE §11`, pregunta 14).

Hasta que eso se responda, F3 se entrega con la pantalla de espera y un botón
explícito de "listo, gracias" que libera la tablet, lo cual es funcional pero
**no es la decisión tomada** y hay que revisarlo en O4.

### RQ-620 — Sin conexión: cartel claro y envío bloqueado

Fuente: `PLAN §8` (riesgos operativos), `REPORTE SIS-05`.

- La tablet muestra un cartel claro de **"sin conexión"**.
- **Bloquea el envío** del pedido.
- **No se encolan pedidos localmente en fase 1.** El riesgo de pedidos duplicados
  o perdidos es peor que el de no vender cinco minutos (`PLAN §8`).

Aceptación: con la API inalcanzable, el botón de confirmar no crea nada y el
cliente ve un mensaje en lenguaje llano, no un error de red.

---

## Qué se demuestra al cerrar S6

1. Un cliente arma un carrito en la tablet navegando por categorías con fotos, en
   tres toques para el primer plato.
2. Sube y baja cantidades con + y −, sin teclado.
3. Escribe su nombre, elige comer aquí o para llevar, y confirma.
4. La tablet muestra el QR activo con el monto en entero de bolivianos en el
   tamaño más grande de la app, y el número de pedido.
5. El pedido existe en la base en `PENDIENTE_PAGO` con su `paymentQrId`.
6. Se apaga el WiFi, se reintenta el envío, y al volver la red se crea **un solo**
   pedido (mismo UUID de intento).
7. Se desactiva un plato desde el panel y desaparece del grid sin recargar la app.
8. Con el WiFi caído, la tablet muestra "sin conexión" y no deja enviar.
9. Un carrito a medias abandonado 60 s vuelve al inicio vacío.

Lo que **no** se puede demostrar al cerrar S6: la liberación de la tablet después
de confirmar queda provisoria hasta que se cierre `H08` (RQ-619).

---

## Tests de este sprint

Fuente: `ARQUITECTURA §8`.

Unitarios, sin DB:
- Cálculo del total del carrito con variantes y cantidades, contra la misma
  función de `packages/shared` que usa el servidor.
- `Money`: el formateo del monto de la pantalla de pago nunca muestra centavos
  (D-04).
- Reductor del carrito: agregar, incrementar, decrementar hasta cero quita el
  item.
- Temporizador de auto-reset: a los 60 s sin actividad con carrito no vacío,
  emite el descarte.

Integración, con DB:
- Idempotencia: el mismo UUID de intento enviado dos veces crea un solo pedido y
  devuelve el mismo número (`ARQUITECTURA §8`, `REPORTE V05`).
- El pedido creado queda con el `paymentQrId` del QR activo en ese momento, y
  cambiar el QR activo después no lo modifica (`REPORTE V13`).
- Confirmar un carrito que contiene un plato desactivado entre medio devuelve un
  rechazo explicable, no crea un pedido inválido (`REPORTE V04`).
- El total se recalcula en el servidor y se ignora el que manda la tablet
  (`PLAN §6`).

No se testea con herramientas de UI automatizada el grid ni la navegación: el
criterio de aceptación de RQ-601 a RQ-608 se verifica a mano sobre la tablet
real, que es lo que importa (`MODULOS §2`: el kiosco se va a rehacer al menos una
vez cuando lo pruebe gente real).

---

## Fuera de alcance en S6

- Confirmación del pago (F4, S7). El pedido queda en `PENDIENTE_PAGO` y ahí se
  detiene.
- Pantalla pública de números listos (F8, S9).
- KDS de cocina (F7, S8).
- Pedidos desde el celular del cliente (`PLAN §2`, fase 2).
- Carga de comprobante por el cliente: descartada (D-05, `PLAN §5f`). El kiosco
  no accede a la galería del teléfono del cliente.
- Añadidos con costo, quitar ingredientes (`PLAN §2`).
- Modo kiosco de Android y screen pinning (O1, S10). En S6 la app corre como una
  app normal.
- Encolado offline de pedidos (RQ-620: queda explícitamente fuera de fase 1).

---

## Riesgos

**`H08` sin cerrar vuelve a S6 un sprint que no cierra del todo.** La liberación
de la tablet no es un detalle de pulido: es el momento en que un cliente ve la
pantalla del anterior. Si se entrega con la solución provisoria de RQ-619 y nadie
vuelve a tocarlo, el sistema arranca en producción con un comportamiento que
nunca se decidió. Hay que preguntarlo antes de O4, no durante.

**El kiosco se va a rehacer.** `MODULOS §2` lo dice sin rodeos: las estimaciones
de frontend son las más inciertas y el kiosco se va a rehacer al menos una vez
cuando lo pruebe gente real. Eso está contemplado dentro de O4 (S10) pero puede
desbordar. Conviene no pulir pixeles antes de que una persona desconocida lo use
de pie en la entrada.

**Confundir el campo de nombre con un detalle de UI.** RQ-611 tiene una
contradicción abierta entre `PLAN §5` y `PLAN §7`. Si se resuelve del lado de
"opcional" sin pensarlo, el panel de cobro pierde la única señal de
desambiguación que le queda tras D-04 (R-01). La decisión del nombre es una
decisión de control financiero disfrazada de decisión de formulario.

**Resaltar el monto de forma equivocada.** D-04 derogó el sufijo de centavos. Si
se copia el diseño viejo de la pantalla de pago (`PLAN §5b`, el diagrama todavía
muestra `Bs 45.42`), se termina resaltando centavos que no existen y confundiendo
al cliente que tipea el monto. El monto es un entero y se resalta completo.

**Carrito que se vacía solo.** RQ-609 pide avisar al confirmar, no vaciar al
instante. La implementación fácil es la contraria: escuchar `catalog.updated` y
limpiar el carrito. Eso le borra la selección al cliente mientras la mira, y es
exactamente lo que `PLAN §7` prohíbe.

**Un `fetch` suelto por pantalla.** `ARQUITECTURA §7` lo nombra como uno de los
dos puntos que definen la robustez del kiosco. Cada pantalla que llame a la red
por su cuenta es un lugar más donde "se cayó el WiFi" se maneja distinto, y la
tablet se cuelga en silencio con gente esperando.
