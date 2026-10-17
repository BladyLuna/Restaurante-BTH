# S8 — Menú y cocina

**Módulos:** F5 `admin/menu`, B9 `kitchen`, F7 `kds`
**Estimación:** 13 jornadas
  - F5 pantalla de menú — 7 j
  - B9 `kitchen` — 2 j
  - F7 pantalla KDS — 4 j
**Estado:** BLOQUEADO por dependencia. Necesita B7 (S3) y B11 (S4).

---

## Por qué este sprint es el hito

**Al cerrar S8, el restaurante puede empezar a usar el sistema de verdad.**

Hasta acá hay partes: el kiosco toma pedidos (S6), el panel cobra (S7), pero la
comida no llega a la cocina por ningún canal digital y la dueña no puede cambiar
su carta sin pedírselo al programador. S8 cierra el circuito completo:

    cliente pide en la tablet → paga por QR → alguien confirma →
    la pantalla de cocina lo muestra → cocina lo prepara → se entrega

Es el primer momento en que el sistema reemplaza un proceso real en vez de
agregarse a uno.

Eso trae una consecuencia incómoda, señalada en `REPORTE H13`: **el sistema va a
manejar plata real antes de que exista el módulo de backups**, que está en S10.
Está advertido y sin corregir. La recomendación del reporte es adelantar `O2` a
antes de este hito.

---

## Objetivo

Que la dueña administre su carta sola, y que la cocina vea los pedidos pagados en
una pantalla sin que nadie se los cante.

---

## F5 — Pantalla de administración del menú

7 jornadas. Es el frontend más grande del sprint. Fuente: `PLAN §3`, `PLAN §7`,
`ARQUITECTURA §6`.

La API ya existe: `B6 catalog` quedó terminado en S2 con 11 requerimientos
(RQ-201 a RQ-211). F5 es la interfaz sobre esos endpoints.

### RQ-801 — Administrar categorías y platos desde el celular

Fuente: `PLAN §3` (`/admin` en navegador de celular o PC), `PLAN §7`.

- Dentro de `/admin`, solo rol `ADMIN` (`PLAN §5g`: la carta es decisión
  comercial).
- Crear, renombrar y reordenar categorías.
- Crear, editar y reordenar platos dentro de cada categoría.
- **Diseñado para el pulgar.** La dueña va a cambiar precios desde el teléfono,
  probablemente de pie en la cocina. Se aplican los criterios de tamaño de
  `PLAN §7` aunque estén escritos pensando en el kiosco.

### RQ-802 — El precio se tipea en bolivianos enteros

Fuente: D-04, RQ-104, `PLAN §5e`.

- El campo de precio **no acepta decimales**. No hay coma, no hay centavos.
- La validación usa el mismo schema Zod que el servidor (`CrearProducto` de
  `packages/shared`), para que el mensaje de error sea idéntico en los dos lados.
- Si tipea `45.42`, el campo lo rechaza antes de mandar nada.

Motivo, textual de la dueña: *"a los bolivianos no les gusta que roben, por eso
el recibo tiene nombre; que sean números enteros como debe de ser"*. D-04.

### RQ-803 — Desactivar, nunca borrar

Fuente: RQ-204, `PLAN §4`, `PLAN §5a`.

- La acción visible es un interruptor **Disponible / Agotado**, no un botón de
  borrar.
- No existe opción de eliminar un plato en la interfaz, porque no existe en la
  API (B6 no tiene ruta `DELETE`, a propósito).
- Los platos agotados se muestran en el panel, atenuados, para poder reactivarlos.

Motivo: borrar un plato rompería los pedidos históricos que lo referencian. Los
`OrderItem` guardan snapshot de nombre y precio justamente para que el historial
sobreviva, pero el producto tiene que seguir existiendo.

**Este interruptor es el que más se va a usar en el día a día.** "Se acabó el
pique macho" a las dos de la tarde es la operación más frecuente de toda la
pantalla. Tiene que estar a un toque desde la lista, sin entrar a editar el plato.

### RQ-804 — Advertencia al cambiar un precio

Fuente: RQ-209, D-07, `PLAN §5c`.

- Antes de guardar un cambio de precio, un diálogo muestra el valor anterior y el
  nuevo.
- Avisa que el cambio **no afecta los pedidos ya tomados**: esos conservan el
  precio con que se pidieron (snapshot en `OrderItem`).
- Deja claro que el cambio queda registrado con su nombre.

Motivo: un precio es lo único de esta pantalla que mueve plata. B6 ya lo audita
dentro de la transacción (RQ-209); la interfaz debe hacer visible que eso está
pasando. No es para intimidar, es para que no haya sorpresas cuando revise el log.

### RQ-805 — Variantes con precio propio

Fuente: RQ-203, `PLAN §4`, `REPORTE CLI-02`.

- Agregar tamaños a un plato: vaso / jarra, porción / media porción.
- Cada variante tiene su precio, también entero.
- Al agregar la primera variante, la interfaz explica que el precio base del
  plato deja de usarse y el cliente va a tener que elegir un tamaño.
- Desactivar la última variante activa devuelve el plato a precio simple (B6 lo
  hace solo; la interfaz debe reflejarlo sin que parezca un error).

### RQ-806 — Fotos de los platos

Fuente: `PLAN §7` (fotos en grid), RQ-206, `ARQUITECTURA §4`.

- Subir una foto desde la galería o la cámara del celular.
- El servidor valida que sea una imagen real y la redimensiona (RQ-206): no se
  confía en la extensión ni en el `Content-Type` del cliente.
- Un plato sin foto muestra un marcador neutro, no un ícono roto.

Las fotos importan más de lo que parece: `PLAN §7` las pone en grid porque el
cliente elige mirando, no leyendo. Un menú sin fotos obliga a leer nombres, y
leer es justo lo que no va a hacer alguien apurado con la fila atrás.

### RQ-807 — Vista previa de lo que ve el cliente

Fuente: `PLAN §7`, criterio de usabilidad.

- Un modo de vista previa que muestra el menú tal como aparece en el kiosco.
- Permite verificar el orden, las fotos y los precios antes de que lo vea un
  cliente.

Motivo: la dueña reordena platos para empujar los que le convienen (`PLAN §7`:
el orden lo decide ella, no el sistema). Sin previa, el resultado del reordenado
solo se descubre yendo físicamente a la tablet.

---

## B9 — `kitchen`

2 jornadas. Fuente: `PLAN §5a`, `PLAN §6`, `ARQUITECTURA §3`, D-10.

Es un módulo chico: la máquina de estados ya está en B1 y las transiciones en B7.
B9 expone la vista de cocina y las dos transiciones que le corresponden.

### RQ-808 — Cola de pedidos pagados

Fuente: `PLAN §5a`, `PLAN §6` (`GET /kitchen/orders`).

- Devuelve los pedidos en `PAGADO`, `EN_PREPARACION` y `LISTO`.
- **Nunca devuelve pedidos en `PENDIENTE_PAGO`.** Cocina no debe enterarse de un
  pedido que no se pagó: si lo ve, lo empieza a preparar.
- Ordenados por hora de pago, no de creación. El que pagó primero come primero.
- Incluye tipo de consumo (`Para llevar` / `Comer aquí`), número de pedido,
  nombre del cliente e ítems con cantidad.

### RQ-809 — Marcar en preparación y listo

Fuente: RQ-102 (matriz de actores de B1), `PLAN §5a`.

- `PAGADO → EN_PREPARACION`, actor `COCINA`.
- `EN_PREPARACION → LISTO`, actor `COCINA`.
- Las transiciones se validan contra la máquina de estados de `packages/shared`,
  no con `if` sueltos en el servicio.
- Cocina **no** puede cancelar ni marcar entregado (D-02: cancelar un pedido
  pagado es de ADMIN; entregar es de CAJA o ADMIN).

Aceptación:
- Un intento de `COCINA` de cancelar un pedido devuelve 403.
- Un intento de pasar `PAGADO → LISTO` salteando preparación es rechazado por la
  máquina de estados.

### RQ-810 — Tiempo de espera por pedido

Fuente: `PLAN §5a`, criterio operativo.

- Cada pedido en la cola expone cuántos minutos pasaron desde que se pagó.
- Es un dato calculado, no almacenado.

Motivo: es lo que permite que la cocina priorice sin que nadie le grite. Un
pedido de hace 20 minutos tiene que destacarse del que entró hace dos.

---

## F7 — Pantalla de cocina (KDS)

4 jornadas. Fuente: `PLAN §3` (`/kds` en navegador), `PLAN §7`,
`ARQUITECTURA §3`, `REPORTE COC-02`.

KDS = *Kitchen Display System*, la pantalla que reemplaza al papel de los
pedidos. Corre en un navegador, en una pantalla o tablet colgada en la cocina.

### RQ-811 — Legible desde lejos y con las manos ocupadas

Fuente: `PLAN §7`, criterio del entorno.

- Tipografía grande: la pantalla se lee a dos metros, no a cuarenta centímetros.
- Tarjetas por pedido, no filas de tabla.
- Los dos botones (`En preparación`, `Listo`) con área de toque generosa: quien
  los va a tocar tiene las manos grasosas o húmedas.
- Contraste alto. La cocina tiene vapor, reflejos y luz directa.

### RQ-812 — Actualización por WebSocket, reconstrucción por HTTP

Fuente: `ARQUITECTURA §3`, RQ-417, `REPORTE COC-02`.

- Los pedidos nuevos aparecen por WebSocket (namespace de cocina, RQ-415).
- **Al conectarse, trae el estado completo por HTTP.** El socket solo transporta
  cambios incrementales.
- Si el socket se cae y vuelve, reconstruye por HTTP otra vez.

Motivo, textual de `ARQUITECTURA §3`: una cocina que depende del socket para
saber qué preparar se queda ciega cuando el WiFi hipa. Y el WiFi del local va a
hipar.

### RQ-813 — Aviso visible de conexión perdida

Fuente: `REPORTE COC-02`, criterio de seguridad operativa.

- Si el socket está caído, un indicador claro y permanente lo muestra.
- Si lleva más de un tiempo sin reconectar, el aviso escala: la pantalla tiene
  que ser imposible de confundir con "no hay pedidos".

Motivo: el peor estado posible de esta pantalla es **una cocina tranquila
creyendo que no hay pedidos** cuando en realidad hay cinco esperando. Una pantalla
vacía por falta de pedidos y una pantalla vacía por socket caído se ven igual. Hay
que distinguirlas.

### RQ-814 — Aviso sonoro de pedido nuevo

Fuente: `PLAN §5a`, criterio operativo.

- Un sonido corto cuando entra un pedido.
- Se puede silenciar, y el estado de silencio es visible.

Motivo: nadie mira la pantalla todo el tiempo. Sin sonido, un pedido puede
esperar diez minutos porque la cocina estaba de espaldas.

### RQ-815 — Los pedidos listos no desaparecen de inmediato

Fuente: `PLAN §5a`, criterio operativo.

- Un pedido marcado `LISTO` permanece visible, visualmente separado, hasta que
  alguien lo entrega (`LISTO → ENTREGADO`, actor `CAJA` o `ADMIN`).
- La transición a `ENTREGADO` no la hace cocina.

Motivo: si el pedido desaparece al marcarlo listo, cocina pierde la referencia de
qué está esperando ser retirado. Y el mostrador necesita verlo para llamar al
cliente.

---

## Qué se demuestra al cerrar S8

El circuito completo, de punta a punta:

1. La dueña agrega un plato nuevo desde su celular, con foto y precio Bs 38.
2. Lo ve en la vista previa tal como lo verá el cliente.
3. Un cliente lo pide en la tablet del kiosco.
4. Paga escaneando el QR.
5. La cajera ve el monto en su panel, lo confirma.
6. **El pedido aparece en la pantalla de la cocina, con sonido.**
7. Cocina lo marca en preparación, y después listo.
8. El pedido sigue visible en la pantalla, separado, esperando entrega.
9. Alguien lo entrega y recién ahí sale de la pantalla.
10. A media tarde se acaba ese plato: la dueña lo marca agotado desde el celular
    y desaparece del kiosco en el acto.
11. Se desconecta el WiFi de la cocina: la pantalla avisa que perdió conexión, de
    forma imposible de confundir con "no hay pedidos".
12. Vuelve el WiFi: la pantalla reconstruye el estado completo sola.

---

## Tests de este sprint

**Integración, con DB:**
- `GET /kitchen/orders` nunca incluye pedidos en `PENDIENTE_PAGO`.
- El orden de la cola es por hora de pago, no de creación.
- `COCINA` puede hacer `PAGADO → EN_PREPARACION` y `EN_PREPARACION → LISTO`.
- `COCINA` no puede cancelar: 403.
- `COCINA` no puede marcar entregado: 403.
- Saltear `PAGADO → LISTO` es rechazado por la máquina de estados.
- Un plato marcado agotado desaparece de `GET /catalog` en la siguiente consulta.
- Cambiar el precio de un plato no altera los `OrderItem` de pedidos ya tomados.

**Frontend:**
- El campo de precio rechaza decimales antes de enviar.
- La interfaz no ofrece ninguna acción de borrado de platos.
- Con el socket caído, la pantalla de cocina muestra el aviso y no una lista
  vacía silenciosa.
- Al reconectar, el estado se reconstruye por HTTP.

---

## Fuera de alcance en S8

- **Impresión de tickets.** No está en `PLAN`. La pantalla reemplaza al papel.
- **Tiempos estimados de preparación por plato.** Sería útil para prometerle algo
  al cliente, pero no está pedido y requiere datos que todavía no existen.
- **Estaciones de cocina separadas** (parrilla, fríos, bebidas). Un restaurante de
  este tamaño tiene una sola cocina.
- **Modificaciones de ítems** ("sin cebolla"). `PLAN §7` es explícito: **un solo
  campo de texto en todo el flujo del kiosco**, el nombre. Agregar notas por ítem
  rompe esa regla y multiplica los casos de la cocina.
- **Inventario.** El interruptor Agotado es manual. No hay descuento automático de
  stock: eso es otro proyecto.
- **Reportes de cocina.** Platos más vendidos, tiempos promedio. Es B12, S9.

---

## Riesgos

**Que el KDS se quede ciego sin avisar.** Es el riesgo más serio del sprint.
Una pantalla vacía por socket caído se ve exactamente igual que una pantalla
vacía por falta de pedidos, y la consecuencia es comida que nunca se prepara
mientras el cliente espera con el pago hecho. RQ-813 existe por esto.
Mitigación: probarlo desconectando el WiFi de verdad, no simulándolo.

**Que F5 se construya como un CRUD genérico.** Son 7 jornadas, el frontend más
grande del sprint, y es tentador generar una tabla con botones de editar y
borrar. Pero la operación más frecuente es un interruptor Agotado a un toque
(RQ-803), y el borrado no debe existir. Un CRUD genérico optimiza lo que casi
nunca se usa y esconde lo que se usa todo el día.

**Que la dueña no encuentre el interruptor Agotado.** Si está enterrado dentro de
la pantalla de edición del plato, a las dos de la tarde con la cocina llena va a
ser más rápido gritar "se acabó" que buscarlo. Y entonces el kiosco va a seguir
vendiendo algo que no existe, el cliente va a pagar, y alguien va a tener que
devolverle la plata — con todo el papeleo de `Refund` que eso implica (RQ-409).

**Que el sistema maneje plata real sin backups probados.** `REPORTE H13`. Al
cerrar S8 el restaurante opera de verdad, y `O2 backups` está en S10. Una caída
de disco antes de eso pierde los cobros del día y el log de auditoría que los
justifica. No es un riesgo de este sprint sino de la planificación, pero se
materializa acá. Mitigación recomendada: adelantar O2 antes de abrir el sistema
al público, aunque sea una versión mínima.

**Que el aviso sonoro se silencie permanentemente.** Alguien lo silencia una vez
en un momento de caos y nadie lo vuelve a activar. Mitigación: que el estado
silenciado sea visible y no sobreviva a un refresh de la página.
