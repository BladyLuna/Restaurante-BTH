# Registro de decisiones

Una entrada por decisión cerrada. Formato: qué se decidió, por qué, qué se
descartó y qué costó.

Para qué sirve esto: en seis meses nadie se acuerda por qué el sistema hace algo
raro. Si la decisión está acá, no se vuelve a discutir desde cero ni se "arregla"
algo que estaba bien a propósito.

Todas las entradas son del 2026-10-16 salvo indicación contraria.

---

## D-01 — Cero integración bancaria en el MVP

**Decisión.** El cobro es con QR estático administrable desde el panel. No hay
API del banco, ni webhook, ni QR dinámico, ni conciliación automática.

**Por qué.** El QR dinámico requiere cuenta empresa, NIT y un contrato de
cobranza con comisión por transacción. El negocio no tiene nada de eso, y
obtenerlo es un trámite de duración desconocida. Esperarlo bloquearía el proyecto
entero.

**Qué se descartó.** Construir las dos implementaciones de `PaymentProvider` en
paralelo. Se mantiene la interfaz como frontera de diseño, pero sin segunda
estrategia ni infraestructura de webhooks: sería trabajo para un futuro que puede
no llegar en la forma prevista.

**Qué cuesta.** La verificación del pago queda en manos de una persona, con todo
lo que eso implica (ver D-02, D-03, R-01). El sistema no puede afirmar que un
pago existe; solo registra que alguien dijo haberlo visto.

**Corrección de una afirmación previa.** `PLAN §5d` decía que el QR dinámico
"elimina los cuatro vectores de engaño". Eso no está demostrado: depende del
contrato bancario, de la autenticación de los webhooks, de la idempotencia de las
notificaciones, de la conciliación y de las devoluciones. Es la dirección
correcta, no una garantía.

**Fuente.** `PLAN §5d`, `REPORTE §16.1`.

---

## D-02 — El rol CAJA queda aprobado

**Decisión.** Existe un rol `CAJA` con capacidad de escritura sobre
`PENDIENTE_PAGO → PAGADO`. Confirma pagos de monto coincidente y marca entregas.
**No** confirma diferencias, **no** cancela pedidos, **no** ve el cuadre ni la
auditoría, **no** gestiona catálogo, QR ni usuarios.

**Por qué.** `PLAN §5b` ya reconocía el problema bajo el título "La dueña es el
cuello de botella": si no está, la cocina no recibe nada y el restaurante se
para. La única mitigación que proponía era hacer el panel más ruidoso, lo que no
resuelve la ausencia de la persona.

**Qué se aclaró en el camino.** Hubo una premisa equivocada que vale registrar:
se pensó que el sistema "reemplaza a la cajera". No es así. Reemplaza a la
cajera que **toma pedidos** — eso lo hace el kiosco. La función de verificar el
pago contra el banco sobrevive necesariamente mientras el QR sea estático.

**Qué se descartó.** Un rol CAJA que confirme pagos sin poder consultar el banco.
Esa variante sí rompe la lógica del negocio: la única evidencia disponible sería
la captura del cliente, que es el vector "captura reciclada" de `PLAN §5b`, y
convierte el panel en el botón verde que todo el diseño existe para evitar.

**Regla derivada.** El permiso de confirmar pagos y el acceso de consulta
bancaria se otorgan juntos o no se otorgan.

**Fuente.** `PLAN §5g`, `REPORTE §§15, 16.2`.

---

## D-03 — CAJA verifica con un celular del negocio

**Decisión.** Un celular queda en el local con la banca móvil de la dueña
abierta. CAJA consulta los abonos ahí. Ese dispositivo está **fuera del sistema**:
no es un componente de software, no requiere desarrollo, no aparece en el modelo
de datos.

**Por qué.** Con QR estático el sistema no recibe señal alguna del banco, así que
la única fuente de verdad sobre un abono es el extracto. Verificar es,
necesariamente, mirar el banco. No hay forma de delegar la confirmación sin
delegar la consulta.

Conviene separar dos cosas que se confunden: *integrar* el banco (API, webhook,
contrato) está fuera de alcance por D-01; *mirar* el banco en una app es trabajo
humano con cero código.

**Qué se descartó.** Esperar un usuario bancario de solo consulta. Si el banco lo
ofrece, mejor — es preferible. Pero no se bloquea el diseño a que exista.

**Qué cuesta, y el sistema no puede mitigarlo.** Una app de banca móvil ya
autenticada normalmente permite transferir. La afirmación "la cajera no puede
mover plata" **no está garantizada por el software**: depende de si el banco
exige credencial por operación. Controles, todos fuera del sistema:

- Verificar en el dispositivo si iniciar una transferencia pide clave o huella.
- Si no la pide: cuenta dedicada a cobros con saldo bajo, barrida al cierre. Así
  la exposición es la recaudación del día y no el patrimonio.
- Preferir acceso de solo consulta si el banco lo ofrece.
- Acordar con la empleada la responsabilidad por faltantes **antes** de operar.

**Fuente.** `PLAN §5g`, `REPORTE §16.3`, `R-02`.

---

## D-04 — Precios en bolivianos enteros: el sufijo de centavos queda derogado

**Decisión.** Todos los precios, subtotales y totales son múltiplos de 100
centavos. `PLAN §5b` declaraba el sufijo de centavos "siempre activo" y "no
configurable"; esa regla queda sin efecto.

**Por qué.** Cobrar Bs 45,42 cuando el plato dice Bs 45 se percibe como abuso.
En el contexto local eso daña la confianza del cliente más rápido de lo que
cualquier control interno compensa.

**Qué se descartó y por qué no alcanzaba.**

- *Mantener el sufijo.* Era el mecanismo que hacía único cada monto y convertía
  el emparejamiento en una búsqueda exacta. Técnicamente superior, comercialmente
  inaceptable.
- *Sufijo invertido como descuento* (cobrar Bs 44,53 en vez de Bs 45). Conserva
  la unicidad y se percibe como rebaja, pero cuesta hasta Bs 0,99 por pedido —
  con 300 pedidos diarios, del orden de Bs 150 por día — y sigue mostrando
  centavos, que es justo lo que se quería evitar.
- *Confiar en el nombre del cliente.* `PLAN §5b` ya lo clasifica como **señal
  blanda**: es común pagar desde la cuenta de un familiar, así que si bloqueara
  rechazaría pagos legítimos a diario.

**Qué cuesta.** Es el costo más alto de todo el conjunto de decisiones, y hay que
decirlo sin adornos: sin sufijo, dos pedidos abiertos pueden tener el mismo total
y un abono de ese monto no identifica unívocamente su pedido. Quedan abiertos
tres de los cuatro vectores de `PLAN §5b`. Ver `R-01`.

**Mitigación adoptada.** Nombre como señal blanda, ventana de 15 minutos, cola
visible, auditoría, cuadre diario, y sobre todo un requerimiento nuevo:
**desambiguación obligatoria por nombre cuando hay dos o más pedidos abiertos
con el mismo total**. Es el único control estructural que queda, y no estaba
especificado en `PLAN.md`.

**Impacto técnico.** `Order.sufijoCentavos` desaparece, `total` iguala a
`subtotal`, el pool de sufijos sale de B8, y `catalog` debe rechazar precios no
múltiplos de 100.

**Fuente.** `PLAN §5b`, `REPORTE §16.4`.

---

## D-05 — El comprobante del cliente es evidencia, no autorización

**Decisión.** No se exige comprobante en el flujo normal. Se carga **solo ante
conflicto**, iniciado por CAJA o ADMIN desde el panel, fotografiando la pantalla
del cliente. Queda en `PaymentProof`, atado al pedido y a su auditoría.

**Por qué, y esta es la razón que decide.** Si hay un comprobante en pantalla en
cada pedido, quien confirma va a terminar mirando la captura en vez del extracto,
porque es más rápido y está a mano. El comprobante obligatorio **degrada** el
control en lugar de reforzarlo, y contradice la regla central de `PLAN §5b`.

La razón secundaria es operativa: el comprobante vive en el teléfono del cliente
y el kiosco no puede acceder a su galería.

**Qué se descartó.** QR en el kiosco para que el cliente suba la imagen desde su
teléfono. Choca con la arquitectura: el servidor está en la LAN (`PLAN §3`) y el
teléfono del cliente en datos móviles. Resolverlo exigiría WiFi para invitados o
exponer la API a internet, ampliando la superficie de ataque sin necesidad.

**Qué cuesta.** Un caso de conflicto requiere un paso manual. Es el intercambio
correcto: se paga fricción en el caso raro en lugar de degradar el control en
todos los demás.

**Pendiente.** Período de retención de esas imágenes — son datos de terceros.

**Fuente.** `PLAN §5f`, `REPORTE §16.6`.

---

## D-06 — Login por PIN, 6 dígitos para quien confirma pagos

**Decisión.** Autenticación por PIN numérico. 6 dígitos para ADMIN y CAJA, 4
admisibles para COCINA. Un PIN por persona, hasheado con argon2. Rate limit en el
login **adelantado de O3 (sprint final) a B3 (primer sprint)**. El guard valida
estado y rol contra la base en cada petición.

**Por qué PIN y no email con contraseña.** Dos razones. La usabilidad —manos
ocupadas, tablet grasosa, fila de gente— y una que pesa más: el servidor vive en
la LAN (`PLAN §3`), de modo que no hay correo saliente. Recuperar una contraseña
por mail sería inoperable justo durante un corte de internet, mientras que
resetear un PIN desde el panel no depende de nada externo.

**Por qué importa aunque no haya banco.** Hubo una objeción razonable: sin
integración bancaria, un PIN débil no permite sacar plata. Es cierto, y la
conclusión igual no se sostiene. El PIN no protege la cuenta bancaria: protege el
botón de confirmar un pago. Un PIN comprometido permite marcar como pagado un
pedido que nadie pagó, y **la pérdida se materializa en comida que sale de la
cocina**. Con CAJA el problema crece, porque el PIN pasa a autorizar movimientos
sobre el dinero de otra persona.

**Por qué el rate limit se adelanta.** Un PIN de 6 dígitos son un millón de
combinaciones, pero sin límite de intentos un script las prueba igual. El rate
limit es lo que hace suficiente al PIN, así que no puede llegar después de que el
sistema ya esté cobrando. Estaba planificado para el sprint final.

**Requisito que sostiene todo lo demás.** Un PIN **por persona**, nunca
compartido. Si todos usan el mismo, `AuditLog` no puede atribuir una
confirmación a nadie y deja de ser prueba. El registro de auditoría vale
exactamente lo que vale el PIN.

**Fuente.** `PLAN §6`, `REPORTE §16.7`.

---

## D-07 — La auditoría financiera se escribe dentro de la transacción

**Decisión.** La fila de `AuditLog` de una confirmación de pago, una cancelación,
un cambio de precio o un cambio de QR se escribe en la **misma transacción** que
el cambio de estado. El listener posterior al commit queda reservado al push del
KDS.

**Por qué.** `ARQUITECTURA §3` establecía, con buen criterio, que los eventos se
emiten después del commit: si se emiten dentro y la transacción falla, cocina
recibe un pedido que en la base no existe. Pero esa regla vale para efectos
secundarios **recuperables** — un push, una impresión.

La auditoría no es recuperable. Si se escribe desde un listener post-commit, hay
una ventana en la que el pedido ya está `PAGADO` y todavía no existe el registro
de quién lo confirmó. Un reinicio del servidor en esa ventana deja un cobro sin
autoría. Con dos personas habilitadas para confirmar, ese es precisamente el dato
que no se puede perder.

**Qué se descartó.** Un outbox transaccional con cola. Resuelve la entrega
garantizada entre procesos distribuidos, que no es el caso: un servidor único en
una LAN. Escribir en la misma transacción es más simple y suficiente.

**Fuente.** `ARQUITECTURA §3`, `REPORTE H06`.

---

## D-08 — La imagen de un QR ya usado es inmutable

**Decisión.** Una vez que un `PaymentQr` tiene al menos un pedido asociado, su
`imagenUrl` no se modifica. Cambiar la imagen crea una fila nueva y archiva la
anterior. Editar solo es posible mientras el QR no haya sido usado.

**Por qué.** `PLAN §5b` ya exigía no borrar QR nunca, para no perder la
trazabilidad de a qué cuenta entró cada pago. Pero archivar no alcanzaba: si la
imagen es editable, los pedidos que apuntan a ese QR quedan referenciando una
imagen que no es la que se les mostró, y el cuadre por cuenta deja de ser
auditable.

**Qué cuesta.** Poco: una fila más por cambio de imagen, en una tabla con pocas
filas.

**Fuente.** `PLAN §5b`, `REPORTE H04`.

---

## D-09 — Cancelar no reembolsa

**Decisión.** Cancelar un pedido pagado es atribución exclusiva de ADMIN, exige
motivo, y crea un `Refund` en estado pendiente que una persona cierra cuando
efectivamente devolvió el dinero.

**Por qué.** El modelo permitía cancelar desde `PAGADO` pero no registraba
retorno de dinero ni obligación pendiente. Sin la tabla, el cierre presentaría
como venta vigente un dinero que hay que devolver, y el cuadre nunca daría.

**La distinción que importa.** El sistema **recuerda la deuda, no mueve plata**.
La devolución la hace una persona por transferencia o efectivo. Confundir
`CANCELADO` con `REEMBOLSADO` sería presentar como resuelto algo que está
pendiente.

**Fuente.** `PLAN §5e` regla 3, `REPORTE H05`.

---

## D-10 — Cada superficie en su dispositivo

**Decisión.**

| Superficie | Dispositivo | Login |
|---|---|---|
| `/kiosk` | Tablet fija en la entrada, modo kiosco Android | Token de dispositivo |
| `/kds` | Navegador en cocina | PIN 4+ dígitos |
| `/admin` | Laptop o celular de CAJA; celular o PC de ADMIN | PIN 6 dígitos |

La tablet del kiosco **no la opera el personal**. CAJA confirma desde su propio
dispositivo entrando a `/admin` por navegador en la LAN, sin instalar nada.

**Por qué.** Ya estaba previsto en `PLAN §3` (tres superficies separadas por ruta
y por rol), pero no se había dicho qué implica para la seguridad: al no compartir
pantalla, ADMIN y CAJA no pueden observarse el PIN. Eso resuelve una de las dos
mitades de `C-04`.

**Qué queda abierto.** Si CAJA usa un dispositivo personal, conserva la sesión
del navegador al desvincularse del negocio. Por eso la revocación debe surtir
efecto en el servidor de inmediato, validando estado y rol contra la base en cada
petición en lugar de confiar en la expiración del JWT (`C-05`, cubierto por
`RQ-114`).

**Fuente.** `PLAN §§3, 5g`, `REPORTE §16.7b`.

---

## D-11 — El cliente paga menos: toda diferencia la autoriza ADMIN

**Fecha.** 2026-10-17
**Estado.** Cerrada. Responde `REGLA 1` de `PLAN §5e` y `PREGUNTAS` Parte 4.

**Qué se decidió.** Cualquier diferencia entre el total del pedido y el monto
recibido, por chica que sea, requiere autorización de ADMIN. No hay umbral de
tolerancia para CAJA.

**Qué se descartó.** La propuesta original de `PLAN §5e` regla 1: "hasta Bs 2 lo
confirma CAJA, más de Bs 2 requiere ADMIN". También se descartaron las variantes
de Bs 5 y de rechazo total.

**Por qué.** Un umbral para CAJA es un monto que se puede regalar sin pedirle
permiso a nadie. Con 300 pedidos diarios, Bs 2 de tolerancia son Bs 600 por día
de margen discrecional, y el log mostraría cada caso como una confirmación
normal. Aceptar menos plata que el total es una decisión comercial, no operativa
(`PLAN §5g`).

**Qué implica.** Más interrupciones para la dueña: cada error de tipeo del
cliente la va a requerir. Es el costo aceptado de que nadie más pueda decidir
sobre el precio.

**Implementación.** `RQ-408` pierde el parámetro de umbral. El endpoint de
confirmación con diferencia queda reservado a ADMIN sin excepciones, y el de
confirmación normal exige coincidencia exacta.

**Fuente.** `PLAN §5e` regla 1, `PLAN §5g`, decisión del usuario 2026-10-17.

---

## D-12 — Pago tardío: no se revive, se crea un pedido nuevo

**Fecha.** 2026-10-17
**Estado.** Cerrada. Cierra `H02` y responde `REGLA 4` de `PLAN §5e`.

**Qué se decidió.** Un pedido vencido y cancelado por timeout **no se revive**.
Si el pago llega después, CAJA genera un pedido nuevo con los mismos ítems y lo
confirma con ese pago.

**Qué se descartó.** Reabrir el pedido vencido, que fue la primera respuesta del
usuario y luego corrigió.

**Por qué.** `CANCELADO` es terminal en la máquina de estados de B1, y el test de
`order-state` recorre las 36 transiciones posibles verificando que solo 6 sean
válidas. Abrir `CANCELADO → PENDIENTE_PAGO` tendría tres consecuencias:

- Quien pueda revivir un pedido puede resucitar uno viejo y atarle el pago de
  otro cliente. Sin el sufijo de centavos (D-04) no hay forma de distinguirlo.
- Habría que decidir si el número de pedido se reusa, lo que rompe el único por
  `(fecha, locationId)`, o se asigna otro, lo que deja dos números para un mismo
  consumo.
- El plato pudo agotarse en esos 20 minutos, y el pedido revivido referenciaría
  algo que ya no está disponible.

Crear un pedido nuevo da el mismo resultado para el cliente —come lo que pidió— y
deja la auditoría limpia: dos filas, una cancelación por timeout y una venta
nueva, cada una con su autor.

**Qué implica.** CAJA necesita una función de "repetir este pedido" que copie los
ítems en dos toques, o el atajo va a ser confirmar algo a mano. Entra como
requerimiento de B7 (S3) y de F4 (S7).

**Fuente.** `PLAN §5e` regla 4, `REPORTE H02`, D-04, decisión del usuario
2026-10-17 (corregida en el mismo intercambio).

---

## D-13 — El nombre del cliente es obligatorio

**Fecha.** 2026-10-17
**Estado.** Cerrada. Responde `PREGUNTA 13`.

**Qué se decidió.** El kiosco exige el nombre del cliente antes de generar el
pedido. No se puede pedir solo con el número.

**Qué se descartó.** Nombre opcional, y nombre obligatorio solo cuando ya hay
otro pedido abierto del mismo monto (condicional).

**Por qué.** Tras derogar el sufijo de centavos (D-04), el nombre es la única
señal que queda para desempatar dos pedidos del mismo total. La desambiguación
obligatoria de `RQ-407` muestra los candidatos para que quien confirma elija, y
sin nombre esa pantalla sería dos filas idénticas: mismo monto, misma hora
aproximada, mismos ítems posibles.

Se descartó la variante condicional porque el kiosco no sabe, en el momento en
que el cliente arma el carrito, si va a haber otro pedido del mismo monto treinta
segundos después. Pedirlo "solo cuando hace falta" no es implementable sin
adivinar el futuro.

**Qué implica.** Sigue cumpliendo `PLAN §7`: **un solo campo de texto en todo el
flujo del kiosco**. Ese campo es este. El nombre sigue siendo señal blanda para
confirmar —la gente paga desde la cuenta de la mamá o de un amigo (`PLAN §5b`)—:
no bloquea la confirmación, solo se muestra para desempatar.

**Fuente.** `PLAN §5b`, `PLAN §7`, `R-01`, D-04, decisión del usuario 2026-10-17.

---

## D-14 — El día de cierre va de 5:00 a 5:00 y cuenta por fecha de pago

**Fecha.** 2026-10-17
**Estado.** Cerrada. Responde `REGLA 5` de `PLAN §5e`.

**Qué se decidió.** La jornada contable va de las 05:00 a las 05:00 del día
siguiente. Un pedido cuenta en el día en que se **pagó**, no en el que se pidió.

**Qué se descartó.** Medianoche a medianoche, y contar por fecha de creación del
pedido.

**Por qué.** Dos razones distintas, una por cada mitad de la regla:

El corte a las 5:00 evita partir en dos un servicio de noche. Con corte a
medianoche, lo que se vendió a las 23:50 y lo que se vendió a las 00:10 del mismo
turno caen en cierres distintos, y ninguno de los dos cuadra con lo que la dueña
contó al cerrar.

Contar por fecha de pago alinea el cierre con el extracto bancario, que es
contra lo que se va a comparar. Un pedido creado a las 23:55 y pagado a las 00:05
aparece en el banco con la fecha del pago; si el sistema lo contara por creación,
el cuadre no daría y habría que explicar la diferencia a mano.

**Qué implica.** `Order.fecha` existe para el número único por día y seguirá
siendo la fecha de creación. El cierre debe agrupar por `pagadoEn`, no por
`fecha`. Son dos conceptos distintos que conviene no confundir al implementar
B12 (S9).

**Fuente.** `PLAN §5c`, `PLAN §5e` regla 5, decisión del usuario 2026-10-17.

---

## D-15 — CAJA confirma pagos con acceso de consulta bancaria

**Fecha.** 2026-10-17
**Estado.** Cerrada. Responde `PREGUNTAS` 1, 2 y 3. **Desbloquea B8.**

**Qué se decidió.** La dueña acepta que una cajera de confianza vea los
movimientos de la cuenta de cobros desde un celular dejado en el local, y
confirme los pedidos en el sistema.

**Qué se descartó.** Que la dueña sea la única con permiso de confirmar. Era una
opción válida y el sistema la soporta, pero significaba que la cocina no recibe
pedidos cuando ella no está.

**Por qué importa.** Es el bloqueo que tenía detenido todo el camino crítico
(`B7 → B8 → F4`). Sin alguien más que pueda confirmar, el restaurante se para
cuando la dueña no está, y el sistema no resuelve el problema que vino a
resolver.

**Lo que esto NO cambia.** CAJA sigue sin poder mover plata: no retira, no
transfiere, no cancela pedidos pagados, no confirma con diferencia de monto
(D-11). Su permiso es confirmar que un pago exacto entró. La autoría queda en
`Order.confirmadoPorId` y en `AuditLog`, dentro de la misma transacción (D-07).

**Fuente.** `PREGUNTAS` Parte 1, `PLAN §5g`, D-02, decisión del usuario
2026-10-17.

---

## D-16 — Cuenta bancaria separada para los cobros

**Fecha.** 2026-10-17
**Estado.** Cerrada. Hace irrelevantes las `PREGUNTAS` 2 y 3.

**Qué se decidió.** El QR de cobro apunta a una **cuenta aparte**, distinta de la
cuenta principal de la dueña, con saldo bajo. Al cierre de cada jornada ella
transfiere lo recaudado a su cuenta principal.

**Qué se descartó.** Usar la cuenta principal y confiar en que la app del celular
prestado pida clave para transferir.

**Por qué.** Las preguntas 2 y 3 del documento investigaban si el banco da un
acceso de solo lectura, y si la app pide autenticación para transferir. El
usuario respondió que no importa y que esa parte sea flexible. **No se puede
dejar así**: si la app del celular prestado transfiere sin pedir clave, la cajera
no tiene acceso a "ver los movimientos" sino a toda la cuenta, y eso ocurre
**por fuera del sistema** — ni el PIN, ni los guards, ni la auditoría lo alcanzan.
El log diría "María confirmó el pedido #47" mientras una transferencia sale del
banco sin dejar rastro en la aplicación.

La cuenta separada vuelve la pregunta irrelevante en lugar de ignorarla: si la
app puede transferir, lo que está expuesto es la recaudación del día, no los
ahorros. Es contención de daño, no prevención, y es lo correcto cuando la
prevención depende de algo que no controlamos.

**Qué implica.** Nada en el código: el sistema no se conecta al banco (D-01) y ya
soporta varios QR con uno activo (`PLAN §5b`). Es una gestión que la dueña hace
en el banco, una vez. Lo que sí cambia es el procedimiento de cierre: aparece un
paso de "transferir lo recaudado", que conviene documentar en S10 junto con el
manual de operación.

**Riesgo residual.** Si la dueña no hace la transferencia diaria, la cuenta de
cobros acumula y el beneficio desaparece. Es un hábito, no un control del
sistema.

**Fuente.** `PREGUNTAS` Parte 1 preguntas 2 y 3, decisión del usuario 2026-10-17.

---

## D-17 — El efectivo queda fuera del MVP

**Fecha.** 2026-10-17
**Estado.** Cerrada. Responde `PREGUNTA 12`. Diferida a v2.

**Qué se decidió.** El MVP solo maneja pago con QR. El cliente que no tiene banca
móvil se atiende por fuera del sistema, en papel, como hasta ahora.

**Qué se descartó.** Registrar ventas en efectivo en esta versión, que fue la
respuesta inicial del usuario ("recibir plata en mano y registrar al sistema").

**Por qué.** El efectivo rompe la propiedad que sostiene todo el diseño: **cada
venta se verifica contra un movimiento bancario**. El efectivo no se verifica
contra nada. Agregarlo exige construir lo que hoy no existe:

- Registro de venta en efectivo, sin contraparte verificable.
- Arqueo de caja: conteo de apertura, conteo de cierre, y quién contó.
- Cierre del día separado por medio de pago, porque cuadran distinto.
- Un faltante de efectivo que el `AuditLog` no puede atribuir a nadie.

Son unas 4 jornadas, y contradicen la restricción que el usuario puso antes:
*"el cajero no puede mover plata tampoco retirar"*. Recibir efectivo es mover
plata.

**Nota para cuando se implemente.** El arqueo no existe para desconfiar de la
cajera: existe para **protegerla**. Sin conteo de apertura y cierre, el día que
falten Bs 50 no hay forma de demostrar que no fue ella. Si el efectivo entra en
v2, el arqueo entra con él; registrar la venta sin arqueo es lo peor de las dos
opciones.

**Fuente.** `PREGUNTA 12`, `PLAN §5g`, decisión del usuario 2026-10-17.

---

## Decisiones pendientes

No están cerradas. No implementar nada que las asuma.

**De la dueña** (ver `PREGUNTAS_PARA_LA_DUENA.txt`):

1. Las políticas financieras de `PLAN §5e` que siguen abiertas: **regla 2** (el
   cliente pagó de más), **regla 3** (cancelar un pedido pagado), **regla 6**
   (qué cifras ve en el cierre) y **regla 7** (plato pagado no preparable).
2. Si CAJA puede confirmar pedidos de jornadas anteriores.
3. Retención de las imágenes de comprobantes (**pregunta 16**).
4. **Pregunta 9** — si los 15 minutos de timeout están bien.
5. **Pregunta 15** — si hace falta ticket impreso.
6. **Pregunta 14** — plan B ante corte de luz o internet en hora pico.
7. **Preguntas 4, 6, 10** — cuántas personas rotan en caja, quién responde si
   falta plata, y si quiere cambiar algo de la matriz de permisos.

**Cerradas el 2026-10-17:** el acceso bancario de CAJA (D-15), la cuenta separada
para cobros (D-16) y el efectivo fuera del MVP (D-17). **Ya no hay bloqueos de
negocio sobre B7 ni B8**: el camino crítico está abierto.

**De diseño, propias:**

10. Liberación de la tablet entre clientes. El auto-reset de 60 s cubre el
    carrito a medias, pero no la pantalla de espera (`H08`, requisito de F3).
11. Plato pagado que cocina no puede preparar. La regla 7 de `§5e` lo resuelve en
    lo operativo; falta el flujo en el sistema (`H14`).
12. Adelantar backups (`O2`) antes del hito operable de S8. `MODULOS.md` los pone
    al final y a la vez los declara no recortables (`H13`).
13. Recalcular el conteo de módulos y jornadas de `MODULOS.md` (`H12`: declara
    19, enumera 24, y ahora hay más).
