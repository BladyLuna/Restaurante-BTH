# Reporte de lógica de negocio por actor y casos de uso

## 1. Propósito y condición del reporte

Documento de análisis para que el propietario del proyecto y otro agente verifiquen qué se pretende construir. No es una implementación ni una especificación aprobada nueva. No modifica los tres documentos fuente.

Fuentes locales:
- `PLAN.md`: producto, alcance, datos, pagos, interfaces y fases. Declara última actualización 2026-10-01.
- `ARQUITECTURA.md`: organización técnica, eventos, idempotencia y pruebas.
- `MODULOS.md`: división del trabajo, sucursales y sprints.

Etiquetas usadas:
- **Documentado**: aparece en las fuentes; no significa construido ni verificado en ejecución.
- **Propuesta de control**: recomendación de este análisis, requiere aprobación.
- **Pendiente**: falta una decisión o existen contradicciones.

Estado observado: el directorio contenía esos tres documentos; no se encontró aplicación, API, migraciones ni pruebas. Todos los casos siguientes describen comportamiento previsto, no disponible.

## 2. Qué negocio estamos modelando

Un restaurante recibe pedidos de autoservicio desde una tablet compartida en la entrada. El cliente elige comida, paga usando un QR bancario y espera. La dueña verifica el ingreso en su banco antes de autorizar la preparación. Cocina prepara y marca la entrega.

No es inicialmente una app de delivery ni una app que cada cliente instala. La tecnología permite una app Android para el kiosco y paneles web para dueña/cocina, pero el uso desde teléfonos de clientes queda fuera de la primera versión.

Objetivo operativo: mantener coherencia entre lo solicitado, el pago que la dueña verificó, lo que cocina prepara y lo que se entrega. El sistema registra confirmaciones humanas; NO consulta el banco ni certifica automáticamente el pago.

### Dentro del alcance documentado
- Un local, tablet de autoservicio, PC servidor local y red LAN.
- Catálogo con categorías, productos, fotos y variantes opcionales de tamaño.
- Notas libres por ítem; modalidad comer aquí o llevar.
- QR estático, gestión de varios QR guardados y uno activo.
- Confirmación manual, cola de cocina, estados, auditoría y cierre.
- Base preparada parcialmente para una futura segunda sucursal.

### Fuera del alcance inicial documentado
- Cuentas e historial de clientes, fidelización y pedidos desde sus celulares.
- Delivery, reservas, mesas, propinas y facturación electrónica.
- Extras con costo y configuración de ingredientes; las notas no equivalen a un catálogo de modificadores.
- WhatsApp/SMS y operación completa multi-sucursal.

Efectivo, tarjeta, pagos mixtos, descuentos, devoluciones y stock por cantidades NO tienen un flujo definido. No deben suponerse incluidos ni prohibidos: requieren decisión.

## 3. Actores y responsabilidades

| Actor | Responsabilidad | Límites |
|---|---|---|
| Cliente en kiosco | Consultar menú, armar y confirmar pedido, pagar externamente, retirar | Sin cuenta; no confirma pagos, modifica precios ni accede a administración |
| ADMIN / dueña | Verificar ingresos, gestionar catálogo y QR, consultar control del negocio | No puede asumir que una captura del cliente demuestra un abono |
| COCINA | Trabajar sobre pedidos autorizados, avanzar preparación y entrega | No gestiona cobros, QR, precios ni configuración |
| Sistema | Validar, calcular, numerar, controlar estados, cancelar pendientes vencidos, notificar | No verifica movimientos bancarios |
| Banco/app bancaria | Recibir el pago y mostrar movimientos a la dueña | Es externo; sin integración en la primera versión |
| CAJA | Posible operador adicional para confirmar cobros | Rol todavía NO aprobado ni especificado |

El kiosco es un dispositivo autorizado, no un usuario administrador. “Sin login de cliente” no equivale a API sin protección: el plan menciona token de dispositivo. Su alta, revocación y alcance siguen pendientes.

## 4. Flujo completo de referencia

1. El cliente consulta el catálogo activo.
2. Selecciona productos, cantidades y tamaño cuando corresponda; agrega notas si las necesita.
3. Indica nombre y modalidad de consumo.
4. Revisa y confirma. El servidor valida productos y precios y crea un pedido numerado.
5. El pedido queda PENDIENTE_PAGO. Se muestra QR, importe exacto y número.
6. El cliente realiza el pago desde su banco o billetera compatible, fuera del sistema.una
7. La dueña observa el abono en SU app bancaria, localiza el pedido y confirma.
8. El pedido pasa a PAGADO y aparece como trabajo autorizado en cocina.
9. Cocina pasa a EN_PREPARACION, luego LISTO.
10. Se anuncia el número; al retirarlo se registra ENTREGADO.
11. La dueña revisa el cierre y lo contrasta manualmente con el banco.

Excepción principal: si no se confirma a tiempo, el sistema prevé cancelar el pendiente. Si el dinero llega tarde o ya llegó sin que la dueña lo confirme, falta un procedimiento de resolución: cancelar un pedido no devuelve dinero.

## 5. Casos de uso del cliente / kiosco

### CLI-01 — Consultar el menú
- Objetivo: saber qué puede pedir y cuánto cuesta.
- Precondiciones: dispositivo autorizado, conexión con la API y catálogo disponible.
- Flujo documentado: ver categorías; consultar productos activos, fotos, precios y tamaños disponibles.
- Resultado: selección informada, sin crear aún un pedido.
- Alternativas: producto sin foto muestra nombre; un producto desactivado desaparece del menú.
- Regla: cambios del administrador se reflejan en vivo.
- Pendiente: comportamiento de categorías inactivas, variantes desactivadas y categoría sin productos; no está detallado.
- Aceptación propuesta: nunca permitir confirmar un producto no vendible aunque permanezca en una pantalla antigua.
- Fuente: PLAN §§2, 4, 7.

### CLI-02 — Armar y modificar el carrito
- Objetivo: definir comida y cantidades antes de comprometer un pedido.
- Flujo documentado: seleccionar producto; elegir tamaño si lo tiene; aumentar/disminuir cantidad; añadir notas; revisar carrito visible.
- Resultado: selección temporal, no pedido enviado a cocina.
- Reglas: producto simple usa precio base; producto con tamaños usa precio de la variante elegida; no hay extras pagos.
- Alternativas: carrito incompleto se descarta tras 60 segundos de inactividad, según el plan.
- Pendientes: límites de cantidad y texto, confirmación antes del reinicio, si notas como “sin maní” son aceptables y cómo advertir que no garantizan ausencia de alérgenos.
- Aceptación propuesta: cantidad inválida y variante ajena al producto deben rechazarse en servidor.
- Fuente: PLAN §§4, 7; ARQUITECTURA §7.

### CLI-03 — Confirmar el pedido
- Objetivo: convertir el carrito en una orden identificable.
- Precondiciones: carrito no vacío y conexión; requisitos exactos del nombre pendientes.
- Flujo documentado: elegir comer aquí/llevar, indicar nombre, revisar importe y confirmar; servidor recalcula, valida, asigna número diario y sufijo, conserva precios/nombres históricos y QR asociado.
- Resultado: pedido PENDIENTE_PAGO con identificador interno y número visible.
- Regla: no confiar en importes enviados por la tablet. Reintentar el mismo intento UUID debe recuperar el mismo pedido, no crear otro.
- Alternativas: producto agotado/desactivado o precio cambiado exige aviso; no vaciar silenciosamente el carrito. Política exacta de aceptación del nuevo precio pendiente.
- Contradicción: se exige mostrar el total con sufijo antes de confirmar, pero se asigna al crear la orden. Hace falta cotización/reserva previa o un paso adicional de aceptación.
- Pendiente: el plan pide nombre en el flujo y permite omitirlo en UI; decidir una única regla.
- Fuente: PLAN §§4, 5, 5b, 7; ARQUITECTURA §7.

### CLI-04 — Consultar instrucciones y efectuar el pago externo
- Objetivo: pagar el pedido correcto a la cuenta correcta.
- Precondición: pedido pendiente con importe y QR asociados.
- Flujo documentado: tablet muestra QR grande, monto exacto y número; cliente paga en su aplicación bancaria.
- Resultado en el sistema: sigue PENDIENTE_PAGO hasta confirmación de la dueña. Mostrar una captura no cambia el estado.
- Alternativas: transferencia por monto distinto se resuelve con la dueña; el sistema contempla confirmación con diferencia y auditoría.
- Pendientes: expiración visible, pago tardío, transferencia duplicada, cliente sin banca móvil y cambio de QR mientras otro cliente está pagando.
- Propuesta de control: mantener inmutable el QR mostrado para una orden ya creada. Cambiar el activo debe afectar órdenes nuevas, no redirigir una en curso.
- Fuente: PLAN §§5, 5b.

### CLI-05 — Esperar y retirar
- Objetivo: conocer cuándo puede recoger el pedido.
- Flujo documentado: recibe número, consulta espera y pantalla pública de listos; retira cuando se anuncia; cocina o caja registra entrega.
- Resultado: ENTREGADO, mediante un operador autorizado, no por una acción pública del cliente.
- Pendientes: cuándo liberar la tablet para el siguiente cliente, cómo conserva el cliente su número sin impresora, qué información puede consultar fuera del kiosco y cómo verificar que quien retira es el destinatario.
- Propuesta de privacidad: pantalla pública solo con números; no exponer nombre completo, notas o pagos.
- Fuente: PLAN §§5, 7, 9.

## 6. Casos de uso de ADMIN / dueña

### ADM-01 — Ingresar al panel
- Objetivo: acceder a funciones de administración con identidad trazable.
- Documentado: PIN, hash Argon2, JWT, limitación de intentos y sesión más corta que cocina.
- Resultado: permisos de ADMIN en su contexto de local.
- Pendientes: identificar qué usuario está entrando antes de validar el PIN, recuperación/cambio de PIN, alta/baja de usuarios, cierre de sesión, duración exacta y credenciales iniciales.
- Propuesta: cada persona que confirma dinero debe tener identidad propia; un PIN compartido no permite atribuir quién confirmó.
- Fuente: PLAN §§2, 6; MODULOS B3/B4.

### ADM-02 — Localizar un pedido a partir del abono bancario
- Objetivo: asociar un ingreso real observado a una orden pendiente.
- Precondiciones: sesión ADMIN y consulta de su propia app bancaria.
- Flujo: observar importe; buscar en el panel; revisar número, nombre, antigüedad y QR/cuenta; seleccionar la coincidencia.
- Regla documentada: partir del pago hacia el pedido, no aprobar porque el cliente afirma haber pagado. Nombre del remitente es señal secundaria, no prueba obligatoria.
- Resultado: candidato listo para confirmar, sin cambiar aún su estado.
- Pendientes: búsqueda por monto completo frente a últimos dos dígitos, múltiples coincidencias, importes erróneos y abonos antiguos o correspondientes a otra cuenta.
- Fuente: PLAN §5b.

### ADM-03 — Confirmar pago exacto
- Objetivo: autorizar la preparación tras verificar el ingreso.
- Precondición documentada: pedido pendiente y abono observado por la dueña.
- Flujo: revisar coincidencia; confirmar; registrar quién, cuándo, importe esperado/recibido; pasar a PAGADO; notificar cocina.
- Resultado: orden autorizada para preparación.
- Propuestas de control: transición y auditoría financiera en una misma transacción; confirmación idempotente; no aprobar dos veces ni aprobar un pedido cancelado por carrera con el vencimiento.
- Pendiente crítico: no existe referencia bancaria única registrada que impida reutilizar el mismo movimiento para varias órdenes. Los centavos ayudan a buscar, no prueban por sí solos que sean pagos distintos.
- Fuente: PLAN §§5, 5b, 5c; ARQUITECTURA §§2–3, 8.

### ADM-04 — Confirmar con diferencia
- Objetivo: resolver un pago que no coincide con el importe solicitado.
- Flujo documentado: ingresar monto realmente recibido; sistema compara; muestra advertencia; requiere confirmación explícita y deja discrepancia auditada.
- Resultado previsto: permite continuar la venta con rastro de diferencia.
- Pendientes: qué diferencia se puede aceptar, quién la autoriza, si falta cobrar saldo, tratamiento del exceso, motivo obligatorio, reportes y posible devolución.
- Riesgo: el texto justifica diferencias pequeñas, pero no establece un límite. No implica autorización para aceptar cualquier importe.
- Propuesta: distinguir importe esperado, recibido, saldo/diferencia y motivo; no alterar los precios históricos para ocultar el descuadre.
- Fuente: PLAN §5b y §5c.

### ADM-05 — Cancelar un pedido
- Objetivo: detener una orden que no debe continuar.
- Documentado: endpoint ADMIN; transiciones a CANCELADO desde PENDIENTE_PAGO o PAGADO; motivo en modelo y auditoría.
- Resultado: pedido deja de avanzar; no se borra la historia.
- Pendientes: motivos admitidos, obligatoriedad del motivo, comunicación a cocina, devolución si ya fue pagado y tratamiento de pagos que lleguen después.
- No documentado: cancelar durante preparación o cuando está listo; la máquina actual lo rechaza.
- Propuesta: no equiparar CANCELADO a REEMBOLSADO. El reembolso requiere trazabilidad independiente si se incorpora.
- Fuente: PLAN §§4–6; ARQUITECTURA §4.

### ADM-06 — Mantener categorías, platos y tamaños
- Objetivo: administrar la carta sin depender del desarrollador.
- Flujo documentado: crear/editar categorías y productos; definir precios, variantes y fotos; ordenar; activar/desactivar.
- Resultado: catálogo actualizado en kiosco.
- Reglas: preservar históricos mediante snapshots; no borrar físicamente productos asociados a pedidos; registrar cambios de precio.
- Alternativas: se agota un plato → desactivar; si está en un carrito, advertir al confirmar; pedido ya creado conserva el precio histórico.
- Pendientes: distinción entre desactivar y archivar, baja de categorías/variantes, efecto sobre pedidos pendientes ya creados, validación de precio cero/negativo y disponibilidad por unidades.
- No confundir: desactivar un plato es control manual de disponibilidad, no gestión de inventario.
- Fuente: PLAN §§4, 6, 7.

### ADM-07 — Gestionar QR de cobro
- Objetivo: escoger la cuenta de cobro sin cambiar código.
- Flujo documentado: subir imagen con etiqueta, guardar varios, activar uno y archivar los que ya no se usan.
- Reglas: un activo; no archivar el único activo; conservar QR referenciados por pedidos; auditar cambios; cada pedido guarda su paymentQrId.
- Límite: el sistema valida que el archivo sea imagen, no que el QR sea bancario, válido o de la dueña.
- Pendientes: estado inicial sin QR, cómo impedir nuevas ventas en ese estado, evitar dos activos por concurrencia, órdenes pendientes del QR antiguo y edición de una imagen ya usada.
- Propuesta: imagen/versionado inmutable para conservar evidencia histórica; cambios afectan nuevos pedidos. Revisar importes recibidos en la cuenta histórica, no solo la actualmente activa.
- Fuente: PLAN §5b.

### ADM-08 — Consultar ventas y cierre
- Objetivo: contrastar lo registrado con los abonos del banco.
- Documentado: ventas del día, platos más vendidos, cierre por QR/cuenta, separación entre subtotal y ajuste de centavos, diferencias y auditoría.
- Flujo: seleccionar jornada; consultar totales; contrastar con movimientos bancarios; investigar discrepancias.
- Resultado: información para conciliación manual, NO conciliación bancaria automática.
- Pendientes: qué fecha define el cierre (creación/pago/jornada), incluir cancelados pagados, pagos tardíos, exceso/faltante, devoluciones, QR diferentes de una misma cuenta y cierre definitivo frente a reporte consultable.
- Propuesta: separar ventas, cobros confirmados, ajustes, diferencias y devoluciones; un único “total” no representa todo eso.
- Fuente: PLAN §§4, 5c, 6, 7.

### ADM-09 — Consultar auditoría y configuración
- Objetivo: reconstruir decisiones y ajustar operación.
- Documentado: auditoría filtrable; configuración del corte diario y timeout de pago.
- Resultado: consulta de acciones y parámetros persistidos.
- Pendientes: quién puede cambiar cada parámetro, efectos retroactivos, retención/protección del registro, trazabilidad del propio cambio de configuración y exportación.
- Propuesta: no editar ni borrar auditorías desde el panel; un cambio de timeout no debe alterar pedidos previos sin regla expresa.
- Fuente: PLAN §§5c, 6; MODULOS B5/B10.

### ADM-10 — Registrar entrega desde caja
- Documentado en narrativa: cocina o caja puede marcar ENTREGADO.
- Inconsistencia: solo existe rol ADMIN y COCINA; no hay endpoint explícito de entrega para ADMIN en el listado.
- Pendiente: decidir si ADMIN también entrega y mediante qué permiso; no suponer que el rol CAJA ya existe.
- Fuente: PLAN §§2, 5, 6.

## 7. Casos de uso de COCINA

### COC-01 — Ingresar y recuperar la cola
- Objetivo: ver trabajo autorizado, incluso después de perder conexión.
- Documentado: sesión por PIN y tablero web; al conectarse consultar HTTP, luego recibir actualizaciones por WebSocket.
- Regla: PENDIENTE_PAGO no entra como trabajo preparable; puede mostrarse solo un contador informativo de pendientes de pago.
- Pendiente: endpoint de cocina lista PAGADO/EN_PREPARACION, pero el tablero también necesita LISTO para organizar entregas. Definir el conjunto completo.
- Aceptación propuesta: reconectar no pierde órdenes ni duplica tarjetas.
- Fuente: PLAN §§5b, 6, 7; ARQUITECTURA §3.

### COC-02 — Empezar preparación
- Precondición: pedido PAGADO.
- Flujo: revisar ítems, cantidades, variantes, notas y modalidad; aceptar/iniciar.
- Resultado: EN_PREPARACION; operación sincronizada con otros dispositivos.
- Regla: no saltar desde PENDIENTE_PAGO a preparación.
- Pendientes: si la acción es un toque o requiere confirmación, quién la realizó, manejo simultáneo por varios cocineros y plato agotado después del cobro.
- Fuente: PLAN §§5, 7; ARQUITECTURA §4.

### COC-03 — Marcar listo
- Precondición: EN_PREPARACION.
- Flujo: terminar el pedido completo y marcar LISTO.
- Resultado: número visible en pantalla pública.
- Pendientes: entregas parciales, rectificaciones por toque accidental y registro de tiempos por estado. El esquema original no incluye marcas temporales para todos los estados.
- Fuente: PLAN §§4, 5, 7.

### COC-04 — Registrar entrega
- Precondición: LISTO.
- Flujo: verificar número/persona según procedimiento aún por definir; entregar físicamente; marcar ENTREGADO.
- Resultado: cierra el flujo operativo, conserva histórico.
- Pendientes: pedido no retirado, entrega equivocada y reversión excepcional. ENTREGADO es terminal según la tabla actual.
- Fuente: PLAN §5; ARQUITECTURA §4.

### COC-05 — Informar imposibilidad de preparar
- Estado: **pendiente; no existe caso resuelto en el plan**.
- Situaciones: ingrediente agotado, error de carta, equipo averiado, nota imposible de cumplir.
- Decisiones necesarias: quién contacta al cliente, si se sustituye, cancela o devuelve dinero y cómo se registra.
- No inventar una acción de cancelación de cocina: no aparece entre sus permisos documentados.

## 8. Automatizaciones y reglas transversales

### SIS-01 — Calcular dinero
- Documentado: centavos enteros, total autoritativo en servidor, cantidades y precio de variante/base, snapshot histórico.
- Fórmula documentada: total a cobrar = subtotal + sufijo.
- Pendiente: política de sufijos cuando los precios ya tienen centavos; también significado contable/comercial del recargo y consentimiento del cliente. No se valida aquí su legalidad.

### SIS-02 — Numerar por jornada/local
- Documentado: contador transaccional y número diario por local; corte configurable.
- Pendiente: zona horaria explícita, definición de jornada, creación concurrente de la primera fila del contador y cambio del horario de corte.
- Propuesta: conservar fecha de jornada y contexto del local con el pedido; no usar solo el número visible como identidad global.

### SIS-03 — Asignar y liberar sufijos
- Documentado: pool 00–99 para pedidos pendientes; liberar al vencer; mecanismo siempre activo; si se agota, permitir sin sufijo con verificación manual.
- Riesgo: unicidad del sufijo NO equivale a unicidad de importe final cuando el subtotal tiene centavos.
- Riesgo: liberar permite reutilización temporal; un pago viejo/tardío puede confundirse con un nuevo pedido.
- Pendientes: cuándo liberar tras pago o cancelación manual, alcance por local/cuenta, concurrencia y política coherente ante agotamiento.

### SIS-04 — Vencer pendientes
- Documentado: cancelación automática de pendientes tras 15 minutos configurables y liberación del sufijo.
- Propuesta: cancelar solo si continúa pendiente al ejecutar la operación; resolver transaccionalmente carrera con confirmación humana; conservar motivo de expiración.
- Pendiente: retraso de la dueña aunque el cliente ya pagó, notificación y resolución posterior.

### SIS-05 — Recuperarse de fallas
- Documentado: bloquear envíos sin conexión; no encolar ventas offline en fase inicial; reintentos idempotentes; reconstruir cocina por HTTP.
- Límite: servidor local permite que la app no dependa de internet, pero no garantiza que el cliente pueda pagar por banco sin conexión ni que la dueña pueda verificar.
- Límite: backup ayuda a recuperar datos; no mantiene el servicio activo durante un corte eléctrico. Falta procedimiento manual/UPS si se necesita continuidad.

### SIS-06 — Auditar y notificar
- Documentado: confirmaciones, cancelaciones, cambios de precio y QR auditados; notificación en tiempo real después del commit.
- Contradicción: arquitectura propone auditoría como listener posterior al commit. Un reinicio puede dejar pago confirmado sin auditoría.
- Propuesta: auditoría financiera junto al cambio de estado dentro de la transacción; push después del commit. Recuperar por HTTP repara una pantalla, no un registro de auditoría ausente.

### SIS-07 — Proteger información y permisos
- Documentado: roles, JWT, PIN con rate limit y contexto de local.
- Pendientes: autorización de lectura individual de pedidos, alcance del token de kiosco, exposición de datos en listos y permisos de eventos WebSocket.
- Propuesta: autorizar en servidor, no solo ocultar botones; cliente no elige su rol o local libremente.

## 9. Máquina de estados y responsabilidades

| Origen | Acción | Destino | Actor previsto | Observación |
|---|---|---|---|---|
| Sin pedido | Confirmar carrito | PENDIENTE_PAGO | Cliente mediante kiosco | Servidor valida y crea |
| PENDIENTE_PAGO | Confirmar abono | PAGADO | ADMIN | CAJA pendiente |
| PENDIENTE_PAGO | Cancelar | CANCELADO | ADMIN | Motivo/política por precisar |
| PENDIENTE_PAGO | Vencer plazo | CANCELADO | Sistema | Carrera con cobro por resolver |
| PAGADO | Iniciar preparación | EN_PREPARACION | COCINA | No implica un nuevo pago |
| PAGADO | Cancelar | CANCELADO | ADMIN | Falta devolución/conciliación |
| EN_PREPARACION | Terminar | LISTO | COCINA | Pedido completo |
| LISTO | Entregar | ENTREGADO | COCINA; caja según narrativa | Permiso ADMIN/CAJA no cerrado |

ENTREGADO y CANCELADO no tienen transiciones de salida. No hay devolución, reapertura, preparación parcial ni cancelación desde EN_PREPARACION/LISTO. Si el negocio necesita esos casos, deben diseñarse, no forzarse mediante cambios manuales en la base.

## 10. Hallazgos prioritarios para revisión

### H01 — Importe único no garantizado por sufijo único [crítico]
Fuente: PLAN §5b.
Dos subtotales diferentes con centavos pueden terminar en el mismo total aunque los sufijos difieran. Debe garantizarse unicidad del monto final dentro del alcance acordado o cambiarse el mecanismo. Aun así, no soluciona por sí solo la reutilización de un movimiento bancario.

### H02 — Liberación y pago tardío [crítico]
Una orden vence, su importe puede reaparecer y el cliente paga después. La ventana de 15 minutos no impide que un banco procese o que una persona realice el pago más tarde. Se necesita procedimiento de revisión, referencia bancaria o alternativa de identificación.

### H03 — Cobrar recargo y conocerlo antes de confirmar [alto]
Fuente: PLAN §5b y CLI-03.
No están alineados el momento de asignación y la promesa de mostrar el total definitivo desde el carrito. También se debe aprobar comercialmente el recargo variable: no es solo un detalle técnico.

### H04 — QR histórico frente a QR activo [crítico]
Cambiar QR en vivo no puede cambiar silenciosamente el destino de pago de un pedido existente. Una FK a una imagen editable tampoco garantiza historial. Especificar inmutabilidad/versionado.

### H05 — Cancelación pagada sin devolución [crítico]
El modelo permite cancelar PAGADO pero no registra retorno de dinero ni obligación pendiente. Definir devolución, autorización y cierre; no presentar dinero recibido como venta vigente sin criterio.

### H06 — Auditoría posterior al commit [crítico]
Fuente: ARQUITECTURA §§2–3 frente a PLAN §5c.
No se garantiza el registro financiero si se guarda solo mediante evento en memoria posterior al commit. Corregir especificación antes de implementar.

### H07 — Diferencias de pago sin política [alto]
Falta tolerancia, motivo, saldo/devolución, autorización y tratamiento contable. La excepción no puede ser un bypass ilimitado.

### H08 — Tablet compartida bloqueada esperando [alto]
Se propone pantalla de espera, pero no se define cómo vuelve al inicio sin perder identificación ni mostrar información del cliente anterior. El reinicio por inactividad descrito corresponde a carrito incompleto, no resuelve todos los estados.

### H09 — Permisos incompletos [alto]
CAJA está pendiente; narrativa de entrega y API no coinciden; gestión de usuarios y revocación del kiosco no descritas. Elaborar matriz explícita. Ver §15: el propietario planteó incorporar CAJA con confirmación de pagos y permiso revocable, lo que abre huecos adicionales no cubiertos por el alcance actual.

### H10 — Cierre sin criterios temporales ni financieros [alto]
No se define qué hacer con cancelaciones pagadas, cobros en otra jornada, discrepancias o varios QR de la misma cuenta. Establecer fórmulas y ejemplos antes del reporte.

### H11 — Capacidad multi-sucursal sobreestimada [medio]
Fuente: MODULOS §0.
Agregar Location a algunas entidades deja una base parcial, no resuelve precios, permisos, catálogo o reportes por local. No afirmar que añadir otro local será únicamente UI.

### H12 — Cronograma y catálogo de módulos inconsistentes [medio]
MODULOS declara 19 módulos, pero enumera B1–B12, F1–F8 y O1–O4. Las jornadas declaradas también deben conciliarse con el calendario y eficiencia. No usar la duración como compromiso comercial hasta recalcular dependencias/capacidad.

### H13 — Puesta en marcha antes de controles esenciales [alto]
MODULOS presenta operación al final de S7 y robustez en S9, pero luego dice que backups no se pueden recortar. PLAN desplaza rate limiting al endurecimiento pese a describirlo como protección de autenticación. Definir mínimos obligatorios ANTES de uso real.

### H14 — Disponibilidad de un producto y excepciones de cocina [alto]
Desactivar no gestiona reservas de stock ni resuelve un pedido ya pagado que no se puede preparar. Acordar actuación manual o ampliar el flujo.

### H15 — Afirmaciones demasiado fuertes sobre QR dinámico [medio]
PLAN §5d afirma que elimina todos los vectores de engaño. Eso no está demostrado: depende del contrato bancario, autenticación/validación de webhooks, idempotencia, conciliación y gestión de devoluciones. No se investigaron aquí APIs ni condiciones bancarias vigentes.

## 11. Preguntas de negocio que debe responder el propietario

1. ¿Aceptamos solamente transferencia QR o también efectivo? ¿Qué pasa con quien no puede pagar por QR?
2. ¿La dueña acepta cobrar centavos adicionales variables? ¿Los precios reales ya incluyen centavos?
3. ¿Se puede identificar cada abono con una referencia bancaria única registrada manualmente?
4. ¿Qué hacer si el cliente paga cuando el pedido venció o si la dueña tarda en confirmar?
5. ¿Quién autoriza diferencias? ¿Cuánto se tolera? ¿Se cobra saldo o se devuelve exceso?
6. ¿Cómo cancelar y devolver un pedido ya pagado? ¿Puede cancelarse durante preparación?
7. ¿Habrá cajeros aparte de la dueña? ¿Qué funciones exactas tendrán?
8. ¿Quién entrega y cómo verifica que la persona recoge el pedido correcto?
9. ¿El nombre es obligatorio? ¿Cómo conserva su número el cliente al liberar la tablet?
10. ¿Las notas permiten solicitudes de ingredientes? ¿Qué hace cocina cuando no puede cumplirlas?
11. ¿Basta desactivar productos manualmente o necesitamos cantidades disponibles?
12. ¿Qué determina la jornada y qué espera ver la dueña en el cierre: ventas, ingresos, pendientes, devoluciones?
13. ¿Cuál es el procedimiento si falla PC, luz, WiFi o banca móvil?
14. ¿Hay impresora y se necesita ticket? ¿Qué datos se mostrarán públicamente?
15. ¿El banco ofrece un servicio contratado de QR dinámico? No asumir disponibilidad ni tarifas.

## 12. Escenarios que otro agente debe verificar

Son criterios propuestos de revisión/prueba, NO tests ejecutados.

| ID | Escenario | Resultado necesario o decisión a cerrar |
|---|---|---|
| V01 | Pedido simple con pago exacto | Flujo completo y trazabilidad sin preparación antes del pago |
| V02 | Producto con tamaño y varias unidades | Precio de variante correcto y snapshot conservado |
| V03 | Precio cambia durante carrito | Aviso y aceptación explícita del total definitivo |
| V04 | Producto se desactiva antes de confirmar | Rechazo explicable, sin crear orden inválida |
| V05 | Respuesta de creación se pierde y se reintenta | Un solo pedido con mismo UUID |
| V06 | Dos confirmaciones simultáneas | Un cambio de estado y una confirmación financiera efectiva |
| V07 | Confirmación y vencimiento simultáneos | Un resultado consistente, sin pago autorizado sobre estado cancelado |
| V08 | Dos subtotales con centavos y sufijos distintos | No asumir unicidad del monto; demostrarla o rechazar la regla |
| V09 | Pool agotado | Política explícita que no contradiga identificación prometida |
| V10 | Pago tardío tras liberar sufijo | No asignarlo automáticamente a otro pedido |
| V11 | Mismo abono reclamado para dos órdenes | Revisión y control contra reutilización |
| V12 | Monto menor o mayor al requerido | Autorización, diferencia y saldo/devolución definidos |
| V13 | Cambio de QR con órdenes pendientes | Cada orden conserva el destino mostrado y su conciliación |
| V14 | Cancelación después del pago | Trazabilidad del dinero y resolución del reembolso |
| V15 | Reinicio tras confirmar pago | Auditoría persistida y cocina recuperable por HTTP |
| V16 | Cocina intenta confirmar pago o cambiar precios | Permiso denegado por servidor |
| V17 | Kiosco consulta pedidos ajenos | Solo información expresamente autorizada |
| V18 | Segundo cliente usa tablet | No hereda datos, carrito ni pago del anterior |
| V19 | Pedido cruza el corte de jornada | Numeración y cierre según criterio explícito |
| V20 | Pedido listo no retirado o entrega equivocada | Procedimiento definido sin falsificar estado |
| V21 | Cambio de QR/configuración concurrente | Invariantes preservadas y auditoría suficiente |
| V22 | Restauración desde backup | Recuperación demostrada antes de operar con datos reales |

## 13. Instrucciones listas para enviar a otro agente

Revisa la lógica de negocio del sistema de restaurante ubicado en `/home/willian/workspace/Trabajo/restaurante`.

Lee primero `PLAN.md`, `ARQUITECTURA.md`, `MODULOS.md` y este `REPORTE_LOGICA_NEGOCIO.md`. El proyecto está en planificación; no confundas requisitos escritos con software implementado.

Tu objetivo es verificar la coherencia del flujo cliente → pago manual → cocina → entrega → cierre, por actor y caso de uso. No implementes, no cambies archivos y no inventes decisiones del negocio.

Entrega:
1. Qué está claramente definido y qué depende de supuestos.
2. Matriz de permisos por actor: cliente/kiosco, ADMIN, COCINA y CAJA solo como posibilidad pendiente.
3. Revisión de máquina de estados, cancelaciones, pagos tardíos, diferencias y devoluciones.
4. Validación crítica del mecanismo de sufijos, reutilización temporal y asociación del abono bancario.
5. Revisión de concurrencia, idempotencia, QR histórico, auditoría y reconstrucción de cocina.
6. Criterios de cierre y mínimos obligatorios para operar con dinero real.
7. Hallazgos priorizados con archivo/sección o líneas de evidencia y contraejemplo cuando corresponda.
8. Preguntas mínimas al dueño y propuestas de corrección claramente separadas de acuerdos existentes.
9. Revisión del alcance y estimaciones; recalcula conteos y tiempos con herramientas, no los copies sin verificar.

No asumas que QR estático identifica la orden, que un screenshot prueba el pago, que una cancelación reembolsa, que un servidor LAN garantiza disponibilidad bancaria, ni que WebSocket garantiza auditoría. No presentes condiciones bancarias o cumplimiento legal como verificados sin fuentes vigentes.

## 14. Conclusión

El modelo central está definido: autoservicio en tablet, confirmación humana del abono, preparación autorizada y entrega. Las interfaces están descritas, pero los casos financieros excepcionales y algunas garantías técnicas todavía no están cerrados.

Recomendación de este análisis: validar pagos/centavos, cancelaciones/devoluciones, permisos, liberación del kiosco y cierre antes de construir los módulos de pedidos y pagos. Se puede preparar infraestructura en paralelo, pero no considerar la especificación financiera lista para producción.

## 15. Rol CAJA — decisión planteada por el propietario

Esta sección registra una intención expresada por el propietario del proyecto el 2026-10-16. **Estado: aprobada por el propietario como alcance del MVP; pendiente de confirmación por la dueña del restaurante en los puntos que dependen de su cuenta bancaria.** Ver §16 para las decisiones cerradas que modifican partes de esta sección.

Nota: §15.3 (acceso de consulta bancaria) queda resuelto por la vía del celular compartido descrita en §16.3. La propuesta de sufijo de centavos evaluada en §15 y en `PLAN §5b` queda **derogada** por §16.4.

### 15.1 Qué se planteó

Incorporar un rol `CAJA` con estas características:

1. Acceso de **consulta** a los movimientos de la cuenta bancaria de la dueña (ver abonos, sin capacidad de giro ni transferencia).
2. Capacidad de **confirmar pagos** dentro del sistema, es decir escritura sobre `PENDIENTE_PAGO → PAGADO`. Sin esto el rol no resuelve el problema.
3. Permiso **otorgable y revocable por la dueña** sobre una cajera concreta que ella asigna.

Motivo declarado: si la dueña no está presente, nadie puede corroborar los pagos y la operación se detiene. `PLAN.md §5b` ya reconoce este problema bajo el título "La dueña es el cuello de botella", pero solo propone mitigarlo haciendo el panel más ruidoso, no distribuyendo la responsabilidad.

### 15.2 Por qué no rompe la lógica de negocio

La regla central de `PLAN.md §5b` es: *"La dueña nunca confirma porque el cliente le diga que pagó. Confirma porque vio el abono en su app bancaria."*

Lo que esa regla protege no es **quién** confirma, sino **contra qué** se confirma: contra el extracto bancario y nunca contra una captura de pantalla del cliente. Un rol CAJA con acceso de consulta al banco preserva la regla intacta. El sistema no pierde ninguna garantía porque nunca tuvo la de verificar el banco: `§3` de este reporte ya establece que el Sistema "no verifica movimientos bancarios" y `PLAN §5b` decide explícitamente no decodificar ni validar el QR. La verificación es humana por limitación del QR estático, no por elección de diseño.

Corrección de una premisa: el sistema **no** reemplaza a la cajera que verifica pagos. Reemplaza a la cajera que **toma pedidos** — eso lo hace el kiosco. La función de verificación bancaria sobrevive necesariamente mientras el pago sea por QR estático, y solo desaparece con QR dinámico y webhook (`PLAN §5d`), que depende de un contrato bancario no investigado.

### 15.3 La variante que SÍ rompe la lógica de negocio

**CAJA que confirma pagos sin acceso de consulta al banco.** En ese caso la única evidencia disponible para la cajera es la captura que le muestra el cliente, que es exactamente el vector *"Captura reciclada"* de `PLAN §5b`, y el botón verde que todo el diseño del panel existe para evitar (`PLAN` líneas 173-177).

Regla de aceptación propuesta: **el permiso de confirmar pagos y el acceso de consulta bancaria se otorgan juntos o no se otorgan.** Si el banco de la dueña no ofrece usuario de consulta sin poder de giro, la decisión vuelve a ella como riesgo asumido, no como detalle técnico que el sistema pueda resolver.

### 15.4 Lo que ya está resuelto y aplica a CAJA sin cambios

- `AuditLog` existe en el modelo de datos (`PLAN §4`) con `userId`, `accion`, `montoEsperado`, `montoRecibido` y `detalle`.
- Módulo `B10 audit` está planificado: 2 jornadas, sprint S3 (`MODULOS §1`).
- `GET /admin/audit` filtrable está en la API (`PLAN §6`).
- `Order.confirmadoPorId` ya persiste quién confirmó cada pago (`PLAN §4`).
- El vector *"Confirmación interna"* (empleada que confirma el pedido de un conocido sin pago) ya está nombrado y mitigado con log de auditoría más cuadre de cierre (`PLAN §§5b, 5c`).
- `MODULOS §1` ya lista "backups y runbook" y "endurecimiento" como no recortables.

La respuesta a "¿tenemos auditoría para sacar un reporte de cambios?" es **sí para operaciones sobre pedidos, productos y QR; no para operaciones sobre usuarios y permisos** (ver 15.5, hueco C-02).

### 15.5 Huecos que abre la propuesta

Numerados aparte de H01-H15 porque dependen de que la dueña apruebe el rol.

**C-01 — No existe gestión de usuarios [crítico]**
Fuente: `PLAN §6` frente a `MODULOS §1`.
El requisito de "dar y quitar el permiso" exige altas, bajas, asignación de rol y revocación. No hay endpoints `/admin/users` en la API, no hay módulo correspondiente en `MODULOS.md`, y `B3 auth` solo cubre login por PIN, argon2, JWT, guards y roles. Hoy los usuarios se crean en el seed de `B2`. El requisito planteado es un módulo nuevo, no una configuración.

**C-02 — `AuditLog` no puede auditar permisos [crítico]**
Fuente: `PLAN §4`.
El esquema tiene `orderId?` y `productId?` pero ningún campo para referenciar al usuario afectado por una acción. Otorgar o revocar la capacidad de confirmar cobros es un evento financiero de la misma categoría que el cambio de QR, que `PLAN §5b` sí exige auditar. Se propone un campo `targetUserId?` y acciones explícitas de tipo `PERMISO_OTORGADO` / `PERMISO_REVOCADO` / `USUARIO_DESACTIVADO`.

**C-03 — El cuadre de cierre no desglosa por operador [alto]**
Fuente: `PLAN §5c`, `MODULOS §1 B12`, `PLAN §6`.
`GET /admin/reports/closing` está especificado como desglose por QR/cuenta. Con dos personas confirmando, la dueña necesita responder "¿quién confirmó qué?" sin leer el log entero. El dato ya existe en `Order.confirmadoPorId`; falta exponerlo como dimensión del reporte. Sin esto, el control de `§5c` pierde buena parte de su utilidad justamente en el escenario que lo hace necesario.

**C-04 — El PIN de 4 dígitos cambia de categoría de riesgo [alto]**
Fuente: `PLAN §6`, `MODULOS §1 O3`.
Mientras la dueña era la única usuaria con poder financiero, un PIN débil era riesgo propio y asumido. Con CAJA, el PIN pasa a ser la credencial que autoriza movimientos de dinero de otra persona, y una cajera puede observar el PIN de la dueña en una tablet compartida. Esto refuerza `H13`: el rate limit de login está hoy en `O3`, sprint S9, después del hito de operación de S7. Decidir longitud mínima del PIN, si CAJA y ADMIN comparten dispositivo, y si el rate limit se adelanta.

**C-05 — Revocación sin efecto sobre sesiones activas [alto]**
Fuente: `PLAN §6`.
"Quitar el permiso" debe surtir efecto inmediato. El JWT de cocina dura toda la jornada y no hay mecanismo descrito de invalidación, lista de revocación ni verificación de `User.activo` en cada petición. Una cajera despedida podría conservar capacidad de confirmar cobros hasta que expire su token. Se propone validar estado y rol del usuario en el guard contra la base, no solo contra el contenido del JWT.

**C-06 — Entrega y cancelación siguen sin definir para CAJA [medio]**
Fuente: `PLAN §§2, 5, 6`; este reporte `ADM-10`.
La narrativa dice "cocina o caja marca ENTREGADO" pero no existe endpoint de entrega para ADMIN ni CAJA. Además hay que decidir si CAJA puede cancelar pedidos y confirmar con diferencia (`PLAN §5b`), que es el camino de excepción con más margen de abuso. Propuesta de revisión: `confirmar con diferencia` podría quedar reservado a ADMIN aunque la confirmación normal se delegue.

**C-07 — Sin límite de alcance temporal ni operativo [medio]**
No se define si CAJA opera solo durante su turno, si puede confirmar pedidos de jornadas anteriores, ni si puede consultar reportes históricos y auditoría. Un rol de confirmación no implica acceso al control del negocio.

### 15.6 Matriz de permisos propuesta

Propuesta de este análisis, no acuerdo existente. `CAJA` depende de C-01 a C-07.

| Acción | CLIENTE/KIOSCO | COCINA | CAJA (propuesto) | ADMIN |
|---|---|---|---|---|
| Consultar catálogo | Sí | Sí | Sí | Sí |
| Crear pedido | Sí | No | Sí | Sí |
| Confirmar pago (monto exacto) | No | No | Sí | Sí |
| Confirmar con diferencia | No | No | Pendiente — se propone No | Sí |
| Cancelar pedido | No | No | Pendiente | Sí |
| Avanzar preparación / LISTO | No | Sí | No | Pendiente |
| Marcar ENTREGADO | No | Sí | Pendiente (C-06) | Pendiente |
| Gestionar catálogo y precios | No | No | No | Sí |
| Gestionar QR de cobro | No | No | No | Sí |
| Ver cuadre de cierre | No | No | Pendiente — se propone No | Sí |
| Ver log de auditoría | No | No | No | Sí |
| Crear usuarios y asignar roles | No | No | No | Sí |
| Revocar permisos | No | No | No | Sí |

### 15.7 Impacto en la planificación

Estimación propuesta, pendiente de validar con el criterio de jornadas de `MODULOS.md`:

- Módulo nuevo `B13 users` (CRUD de usuarios, asignación y revocación de rol, desactivación): orden de 3 jornadas.
- Pantalla de administración de usuarios en el panel, dentro de `F4`/`F6` o como `F9`: orden de 2 jornadas.
- Ampliación de `AuditLog` con `targetUserId` y acciones de permisos, dentro de `B10`: orden de 0,5 jornadas.
- Desglose por operador en `B12 reports`: orden de 0,5 jornadas.
- Verificación de estado/rol contra la base en los guards de `B3`: orden de 0,5 jornadas.

Dependencias: `B13` depende de `B3`; el desglose por operador depende de `B8` y `B12`. Nada de esto altera el camino crítico `B1 → B2 → B7 → B8 → F4` descrito en `MODULOS §3`.

Nota sobre `H12`: el conteo de módulos de `MODULOS.md` ya es inconsistente (declara 19 y enumera 24 entre B1–B12, F1–F8 y O1–O4). Agregar módulos exige recalcular ese total, no incrementarlo sobre una cifra ya errónea.

### 15.8 Preguntas adicionales para la dueña

Se suman a las de §11, y la 7 de esa lista queda subsumida aquí.

16. ¿Acepta que una empleada vea los movimientos de su cuenta bancaria? Es el requisito que hace viable el rol; sin él, CAJA solo podría confirmar contra capturas del cliente.
17. ¿Su banco ofrece usuario adicional o acceso de consulta sin poder de transferencia? Hay que verificarlo en el banco, no suponerlo.
18. ¿Cuántas cajeras y con qué rotación? Determina si la gestión de usuarios es una pantalla ocasional o de uso diario.
19. ¿Quiere revocar el permiso conservando la cuenta, o desactivar la cuenta completa? Son dos operaciones distintas.
20. ¿Debe CAJA poder confirmar con diferencia, cancelar pedidos pagados y ver el cuadre del día? Es la frontera entre confirmar cobros y administrar el negocio.
21. ¿Habrá un dispositivo separado para caja, o compartirá la tablet con la dueña? Afecta la política de PIN y de sesión.

### 15.9 Escenarios de verificación adicionales

Criterios propuestos de revisión, NO tests ejecutados. Continúan la numeración de §12.

| ID | Escenario | Resultado necesario o decisión a cerrar |
|---|---|---|
| V23 | CAJA confirma un pago de monto exacto | Transición válida y `AuditLog` con su `userId`, no el de la dueña |
| V24 | La dueña revoca el permiso con sesión de CAJA activa | La siguiente confirmación es rechazada por el servidor sin esperar expiración del JWT |
| V25 | CAJA intenta gestionar catálogo, QR, usuarios o auditoría | Permiso denegado por el servidor, no solo oculto en la UI |
| V26 | Cuadre de cierre con pagos confirmados por dueña y por CAJA | Totales desglosables por operador y conciliables con el banco |
| V27 | CAJA y ADMIN confirman el mismo pedido simultáneamente | Una sola confirmación financiera efectiva y un solo registro de auditoría |
| V28 | Alta, cambio de rol y baja de una cajera | Cada operación auditada con el usuario afectado identificado |
| V29 | Cajera dada de baja intenta iniciar sesión | Acceso denegado y evento registrado |
| V30 | CAJA confirma un pedido de una jornada anterior | Política explícita según la decisión de C-07 |

### 15.10 Recomendación de este análisis

El rol es conceptualmente compatible con el diseño y resuelve un cuello de botella que `PLAN §5b` ya reconoce sin resolver. **No está listo para planificar como módulo** hasta que se cierren tres cosas, en este orden:

1. La dueña confirma que acepta dar acceso de consulta bancaria a una empleada (pregunta 16). Es una decisión de negocio, no técnica, y sin un sí todo lo demás es trabajo perdido.
2. Se define la matriz de permisos de §15.6 sin casillas pendientes.
3. Se aprueban `C-01`, `C-02` y `C-05` como alcance, porque sin gestión de usuarios, auditoría de permisos y revocación efectiva, el requisito "la dueña da y quita el permiso" no existe en el sistema.

Mientras eso no se cierre, `payments` (`B8`) debe construirse sin suponer que el confirmador es la dueña: la autoría de la confirmación debe venir del usuario autenticado y quedar en auditoría, lo que el modelo ya permite vía `Order.confirmadoPorId`. Eso mantiene la puerta abierta sin construir el rol.

## 16. Alcance cerrado del MVP

Decisiones tomadas por el propietario del proyecto el 2026-10-16. Estas **sí** son acuerdos de alcance, no propuestas. Donde contradicen a `PLAN.md` o a secciones anteriores de este reporte, manda esta sección, y `PLAN.md` debe actualizarse en consecuencia.

### 16.1 Qué entra y qué no

Dentro del MVP:
- Cobro mediante **QR estático** administrable desde el panel (subir, etiquetar, activar, archivar).
- **Verificación humana** del pago por dos actores: ADMIN (dueña) y CAJA (cajera asignada).
- Precios y totales en **bolivianos enteros**.
- Comprobante del cliente **solo como evidencia de conflicto**, nunca como autorización.

Fuera del MVP, explícitamente diferido a v2:
- Integración bancaria de cualquier tipo: API, webhook, QR dinámico, conciliación automática.
- Todo lo que requiera cuenta empresa, NIT o contrato de cobranza.

Consecuencia de alcance: `PLAN §5d` deja de ser "la salida real" del diseño actual y pasa a ser una nota de evolución futura. La abstracción `PaymentProvider` de `ARQUITECTURA §4` se mantiene **solo** como frontera de diseño; no se implementa una segunda estrategia ni se construye infraestructura de webhooks en el MVP. No declarar soporte de QR dinámico como capacidad del sistema.

### 16.2 El rol CAJA queda aprobado

`CAJA` entra al MVP como rol de pleno derecho con capacidad de escritura sobre `PENDIENTE_PAGO → PAGADO`. La matriz de §15.6 se adopta con las casillas pendientes resueltas así:

| Acción | CAJA |
|---|---|
| Confirmar pago de monto coincidente | Sí |
| Confirmar con diferencia de monto | No — reservado a ADMIN |
| Cancelar pedido pagado | No — reservado a ADMIN |
| Marcar ENTREGADO | Sí |
| Adjuntar comprobante de conflicto | Sí |
| Cuadre de cierre, auditoría, usuarios, QR, precios | No |

Esto cierra `C-06` y `C-07` en lo esencial. Queda abierto si CAJA puede confirmar pedidos de jornadas anteriores (pregunta para la dueña).

`C-01`, `C-02`, `C-03` y `C-05` quedan **confirmados como alcance obligatorio del MVP**: sin gestión de usuarios, auditoría de permisos, desglose por operador y revocación efectiva, el requisito "la dueña da y quita el permiso" no existe.

### 16.3 Cómo verifica CAJA — el flujo operativo

El propietario planteó inicialmente que CAJA "solo verifica el pago" sin acceso bancario. Esa combinación es imposible: con QR estático el sistema no recibe ninguna señal del banco, de modo que la única fuente de verdad sobre la existencia de un pago es el extracto de la cuenta. Verificar es, necesariamente, mirar el banco.

**Solución adoptada:** un celular del negocio permanece en el local con la banca móvil de la dueña abierta. CAJA consulta los abonos en ese dispositivo. El celular está **fuera del sistema**: no es un componente de software, no requiere desarrollo y no aparece en el modelo de datos. Es un activo físico del local, como la tablet.

Flujo de CAJA (CAJ-01, confirmar un pago):
1. El cliente confirma su pedido en el kiosco; queda en `PENDIENTE_PAGO` con número y monto entero.
2. El cliente paga escaneando el QR estático desde su propia app bancaria.
3. CAJA observa el abono en el celular del negocio.
4. CAJA localiza el pedido en el panel por monto y nombre, y lo contrasta con lo observado.
5. CAJA confirma. El servidor registra la transición y `AuditLog` persiste su `userId`, no el de la dueña.
6. El pedido pasa a `PAGADO` y entra como trabajo autorizado en cocina.

Excepciones: monto no coincidente y pedido inexistente en el extracto derivan a ADMIN (§16.5, reglas 1 y 2). CAJA no resuelve diferencias.

**Riesgo operativo que el sistema no puede mitigar:** una app de banca móvil ya autenticada normalmente permite transferir. La afirmación "el cajero no puede mover plata" no está garantizada por el sistema — depende de si el banco exige credencial por operación. Controles propuestos, todos fuera del software:
- Verificar en el dispositivo si una transferencia pide clave o huella nuevamente.
- Si no la pide: usar una cuenta dedicada a cobros con saldo bajo, barrida al cierre, de modo que la exposición sea la recaudación del día y no el patrimonio.
- Preferir un acceso de solo consulta si el banco lo ofrece.
- Acordar con la empleada la responsabilidad por faltantes antes de comenzar la operación.

### 16.4 Precios enteros — el sufijo de centavos queda derogado

Todos los precios, subtotales y totales son **múltiplos de 100 centavos**. `PLAN §5b` declara el sufijo de centavos "siempre activo" y "no configurable"; esa regla queda sin efecto. Motivo de negocio: un recargo de centavos no anunciado se percibe como abuso y deteriora la confianza del cliente.

**Lo que esto cuesta, explícitamente.** El sufijo era el mecanismo de emparejamiento entre un abono y un pedido. Sin él, dos pedidos abiertos pueden tener el mismo total, y un abono de ese monto no identifica unívocamente a su pedido. Quedan abiertos tres de los cuatro vectores de `PLAN §5b`: "un pago, dos pedidos", "pago ajeno" y "captura reciclada".

**Mitigación adoptada**, sin mecanismo criptográfico ni bancario:
- Nombre del cliente como señal, reconocida como **blanda** por `PLAN §5b` (es común pagar desde la cuenta de un familiar). No bloquea por sí sola.
- Número de pedido y ventana de expiración.
- Cola de pendientes visible en el panel.
- **Requisito nuevo para `B8`/`F4`:** cuando existan dos o más pedidos abiertos con el mismo total, el panel debe marcarlos como ambiguos y exigir una desambiguación explícita por nombre antes de permitir la confirmación. Esto no estaba especificado en `PLAN.md` y es ahora el único control estructural contra la confusión de pagos.
- Auditoría y cuadre diario como control posterior.

Este es un **riesgo residual aceptado conscientemente**, no un problema resuelto. Debe quedar escrito como límite conocido del MVP y no presentarse como verificación robusta. `H01` y `H03` se reemplazan por este riesgo; `H02` (pago tardío) persiste y se agrava, porque ya no hay sufijo que liberar ni reutilizar como señal.

Impacto técnico menor: `Order.sufijoCentavos` desaparece del modelo, `totalACobrar` iguala a `subtotal`, y el pool de sufijos sale del alcance de `B8`. Validación nueva: rechazar precios no múltiplos de 100 en `catalog`.

### 16.5 Políticas financieras propuestas

Redactadas para que la dueña las apruebe o las modifique (ver `PREGUNTAS_PARA_LA_DUENA.txt`). Cierran `H05` y `H07`. **No se consideran acordadas hasta que ella responda.**

1. **Pago insuficiente.** Diferencia de hasta Bs 2: CAJA confirma y queda en auditoría. Más de Bs 2: solo ADMIN autoriza. El cliente no retira hasta completar o hasta autorización expresa.
2. **Pago en exceso.** Se devuelve de caja chica y se registra. Sin efectivo disponible, decide ADMIN.
3. **Cancelación de pedido pagado.** Solo ADMIN. Motivo obligatorio. Genera una **obligación de devolución pendiente** que se cierra manualmente. Cancelar no equivale a reembolsar: el sistema recuerda la deuda, no mueve dinero.
4. **Pago tardío tras la expiración.** El pedido no se revive. Se crea un pedido nuevo o queda como devolución pendiente.
5. **Definición de jornada.** Corte a las 05:00. Un pedido pertenece a la jornada en que fue **pagado**, no en que fue creado.
6. **Contenido del cierre.** Cuatro cifras separadas, nunca un total único: ventas confirmadas, monto esperado en cuenta, devoluciones pendientes y confirmaciones con diferencia. Más desglose por operador (`C-03`).
7. **Plato pagado no preparable.** Cocina avisa; se ofrece sustitución de igual precio o devolución según la regla 3.

### 16.6 Comprobante del cliente — evidencia, no autorización

Se evaluó exigir al cliente la carga de su comprobante. **Decisión: no exigirlo en el flujo normal.**

Dos razones. La primera, operativa: el comprobante reside en el teléfono del cliente y el kiosco no puede acceder a su galería. La segunda, y determinante: un comprobante visible en pantalla en cada pedido desplaza la verificación hacia la captura y lejos del extracto bancario, porque es más rápido y está a mano. El comprobante obligatorio **degrada** el control en lugar de reforzarlo, y contradice la regla central de `PLAN §5b`.

Alcance adoptado: carga de comprobante **solo ante conflicto**, iniciada por CAJA o ADMIN desde el panel, mediante fotografía de la pantalla del cliente. Queda asociada al pedido y a su registro de auditoría. Su valor es probatorio para una reclamación posterior; **no habilita la confirmación**.

Descartado por incompatibilidad arquitectónica: QR en el kiosco para que el cliente suba la imagen desde su teléfono. El servidor vive en la LAN del local (`PLAN §3`) y el teléfono del cliente está en datos móviles; resolverlo exigiría WiFi para invitados o exponer la API a internet, ampliando la superficie de ataque sin necesidad.

Pendiente de decisión: período de retención de esas imágenes (datos de terceros).

### 16.7 El PIN sigue siendo relevante

El propietario consideró que, al no haber integración bancaria, el PIN débil deja de importar. **No es así, y conviene precisar por qué.**

El PIN no protege la cuenta bancaria. Protege la acción de confirmar un pago. Un PIN comprometido permite marcar como pagado un pedido que nadie pagó, y la pérdida se materializa en **comida que sale de la cocina**, no en transferencias. Con la incorporación de CAJA el problema crece: el PIN pasa a autorizar movimientos sobre el dinero de otra persona, y un dispositivo compartido facilita su observación.

`C-04` queda **resuelto como alcance**: PIN de 6 dígitos para roles con capacidad de confirmar pagos (ADMIN y CAJA), 4 dígitos admisibles para COCINA, y el rate limit de login se adelanta de `O3` (S9) a `B3` (S1). Autenticación por PIN confirmada frente a email/contraseña: el servidor vive en la LAN (`PLAN §3`), de modo que la recuperación por correo sería inoperable durante un corte de internet, mientras que el reseteo de PIN desde `B13` no depende de conectividad externa.

Requisitos derivados, obligatorios: un PIN por persona (nunca compartido), hash con argon2 sin almacenamiento reversible, y reseteo desde el panel de usuarios. Sin PIN individual el `AuditLog` pierde valor probatorio, porque no puede atribuirse una confirmación a una persona.

### 16.7b Dispositivos — asignación cerrada

| Superficie | Dispositivo | Login |
|---|---|---|
| `/kiosk` | Tablet fija en la entrada, modo kiosco Android (`O1`) | Sin login de usuario; token de dispositivo |
| `/kds` | Navegador en cocina | PIN de 4+ dígitos, rol COCINA |
| `/admin` | Laptop o celular de CAJA; celular o PC de ADMIN | PIN de 6 dígitos |

La tablet del kiosco **no es operada por el personal**. CAJA confirma desde su propio dispositivo accediendo a `/admin` por navegador en la LAN, sin instalar nada. Esto resuelve `C-04` en su parte de dispositivo compartido: ADMIN y CAJA no comparten pantalla, de modo que no hay observación mutua del PIN.

Consecuencia para `C-05`: si CAJA usa un dispositivo personal, conserva la sesión del navegador al desvincularse del negocio. La revocación debe surtir efecto en el servidor de inmediato, validando estado y rol contra la base en cada petición, no confiando en la expiración del JWT.

### 16.8 Qué cambia en la planificación

Sale del alcance:
- Pool de sufijos de centavos en `B8`.
- Segunda implementación de `PaymentProvider`, webhooks y conciliación automática.

Entra al alcance:
- `B13 users` — CRUD de usuarios, asignación y revocación de rol, desactivación (`C-01`), orden de 3 jornadas.
- Pantalla de usuarios en el panel, orden de 2 jornadas.
- `targetUserId` y acciones de permisos en `AuditLog`, dentro de `B10`, orden de 0,5 jornadas.
- Desglose por operador en `B12`, orden de 0,5 jornadas.
- Validación de estado y rol contra la base en los guards de `B3` (`C-05`), orden de 0,5 jornadas.
- Detección y desambiguación de montos iguales en `B8`/`F4` (§16.4), orden de 1 jornada.
- Comprobante de conflicto: tabla, almacenamiento y captura desde el panel, orden de 0,5 jornadas.
- Obligación de devolución pendiente y su cierre manual (`H05`), orden de 1 jornada.

El camino crítico `B1 → B2 → B7 → B8 → F4` no cambia. El conteo de módulos de `MODULOS.md` debe recalcularse de todos modos (`H12`: declara 19 y enumera 24).

### 16.9 Qué sigue bloqueando el inicio del desarrollo de pagos

Resueltos por esta sección: `H01`, `H03`, `H05`, `H07`, `C-01` a `C-07`.

Resueltos por corrección de especificación el 2026-10-16:
- `H06` — `ARQUITECTURA §3` incorpora la excepción de auditoría financiera: `AuditLog` de confirmaciones, cancelaciones, cambios de precio y cambios de QR se escribe dentro de la misma transacción que el cambio de estado. El listener posterior al commit queda reservado al push del KDS.
- `H04` — `PLAN §5b` incorpora la inmutabilidad de la imagen de un `PaymentQr` con pedidos asociados: cambiar la imagen crea una fila nueva y archiva la anterior.

**No resueltos, y son requisito para `B7`/`B8`:**
- `H02` — pago tardío. Agravado por §16.4. Cubierto por la regla 4 de §16.5, pendiente de aprobación de la dueña.
- `H08` — liberación de la tablet compartida entre clientes. Decisión de UI, requisito de `F3`.
- `H14` — plato no preparable después del cobro. La regla 7 de §16.5 lo cubre en lo operativo; falta el flujo en el sistema.
- `H13` — mínimos obligatorios antes de operar con dinero real: backups probados y rate limit adelantados respecto de S9. El rate limit queda adelantado a `B3` por §16.7; backups (`O2`) siguen en S9 y deben moverse antes del hito operable de S7.

Módulos que **sí** pueden iniciarse de inmediato, sin depender de lo anterior: `B1 shared`, `B2 infra`, `B3 auth`, `B4 locations`, `B6 catalog` y `F1` contra API mockeada.
