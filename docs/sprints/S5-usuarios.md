# S5 — Usuarios y permisos

**Módulos:** B13 `users`, F9 `admin/usuarios`
**Estimación:** 5 jornadas
  - B13 `users` — 3 j
  - F9 pantalla de usuarios — 2 j
**Estado:** BLOQUEADO por dependencia. Necesita B3 (hecho) y B8 (S4).

---

## Por qué existe este sprint

**No estaba en `MODULOS.md`.** Nació de un pedido explícito de la dueña:

> "la duena deberia quitar y dar el premiso a la cajera que asigno por seguridad"

Fuente: `REPORTE C-05`, `PLAN §5g`.

Hasta S4, los usuarios se crean en el seed y se modifican con SQL. Eso alcanza
para desarrollar, pero significa que **la dueña depende del programador** para
dar de alta a una cajera nueva o para quitarle el acceso a una que se fue. Es
inaceptable en operación: la rotación de personal en un restaurante no espera a
que alguien tenga tiempo de correr un script.

El sprint es corto porque los cimientos ya están: `B3 auth` dejó el hash de PIN,
la validación de forma, la revocación con efecto inmediato y la auditoría de
cambios de PIN. S5 pone la interfaz sobre eso.

---

## Objetivo

Que la dueña administre quién puede entrar al sistema y qué puede hacer, sin
ayuda técnica y con registro de cada cambio.

---

## B13 — `users`

3 jornadas. Fuente: `PLAN §5g`, `PLAN §6`, `REPORTE C-02`, `REPORTE C-05`, D-03.

Profundidad de slice: `controller → service → Prisma` directo, sin repositorio.
Fuente: `ARQUITECTURA §2`.

### RQ-501 — Listar usuarios del local

Fuente: `PLAN §6` (`GET /admin/users`).

- Solo `ADMIN`.
- Devuelve nombre, rol, estado activo/inactivo y fecha de último acceso.
- **Nunca devuelve el `pinHash`**, ni truncado, ni en ningún campo derivado.
- Incluye los inactivos: la dueña tiene que poder ver a quién le quitó el acceso
  y cuándo, y poder reactivarlo si la persona volvió.

Aceptación:
- La respuesta no contiene la cadena `pinHash` en ninguna forma.
- Un usuario desactivado aparece en la lista marcado como inactivo.

### RQ-502 — Crear un usuario

Fuente: `PLAN §6` (`POST /admin/users`), `PLAN §5g`, RQ-112.

- Solo `ADMIN`.
- Recibe nombre, rol y PIN inicial.
- Valida la forma del PIN con `validarFormaPin` de B3: 6 dígitos para `ADMIN` y
  `CAJA`, 4 admisibles para `COCINA` (D-03, `REPORTE C-04`).
- Rechaza PINs obvios: `1111`, `1234`, `123456`, `000000`.
- Rechaza un PIN que ya esté en uso por otro usuario activo del local.
- Guarda solo el hash argon2id. El PIN en claro no se persiste ni se loguea.

**Lo del PIN duplicado no es un detalle.** B3 descubrió por un test que si dos
usuarios activos comparten PIN, el login no puede distinguirlos y la auditoría
mentiría: el cobro quedaría atribuido a quien el sistema encontró primero. El
servicio de login ya rechaza ese caso, pero es mejor **impedir que se cree** que
dejar a dos personas sin poder entrar.

Fuente de la regla de fondo: `PLAN §5g` ("un PIN por persona, nunca compartido"),
que es lo que hace que `AuditLog` valga como prueba.

Aceptación:
- Crear un usuario con un PIN ya usado por otro activo devuelve 409 con un
  mensaje que no revele de quién es el PIN.
- Crear un `CAJA` con PIN de 4 dígitos es rechazado.
- Crear una `COCINA` con PIN de 4 dígitos es aceptado.

### RQ-503 — Dar y quitar el permiso

Fuente: `REPORTE C-05`, pedido textual de la dueña, `PLAN §5g`, RQ-114.

**Es el requerimiento que originó este sprint.**

- Solo `ADMIN`.
- Desactivar un usuario (`activo = false`) le quita el acceso **de inmediato**.
- Reactivarlo lo devuelve con el mismo PIN que tenía.
- Cambiar el rol de un usuario tiene efecto en el acto.

"De inmediato" significa que no hay que esperar a que venza su token. B3 ya lo
resolvió en `verificarToken`, que consulta estado y rol en la base **en cada
request** (RQ-114). Lo que falta en S5 es que haya un botón para accionarlo.

Un token con 8 horas de vida cuya revocación tardara 8 horas no sería una
revocación. Si la cajera se va a mitad de turno con el navegador abierto en el
celular, la dueña necesita que el acceso muera cuando ella toca el botón.

Aceptación:
- Una sesión abierta de la cajera deja de funcionar en el siguiente request
  después de que la dueña la desactiva.
- Si se la reactiva, el PIN anterior vuelve a funcionar.
- Cambiar de `CAJA` a `COCINA` le quita el acceso al panel de cobro sin que
  tenga que volver a entrar.

### RQ-504 — Resetear el PIN de otra persona

Fuente: `PLAN §5g`, D-03 (motivo del PIN como login), RQ-112.

- Solo `ADMIN`.
- Asigna un PIN nuevo a cualquier usuario del local.
- Las mismas validaciones de forma que al crear (RQ-502).
- Invalida las sesiones abiertas de esa persona.

Motivo: el PIN se guarda hasheado y **nadie puede leerlo**, ni el programador. Es
lo que lo hace confiable como prueba de autoría, y también significa que un PIN
olvidado no se recupera: se reemplaza. D-03 lo eligió así explícitamente frente a
email + contraseña, porque recuperar una contraseña exige mandar correo y el
servidor vive en la LAN del local — sin internet, la dueña no podría entrar a
cobrar.

Aceptación:
- La respuesta del endpoint no incluye el PIN nuevo en texto. Se le comunica a la
  persona verbalmente; el sistema solo confirma que se cambió.
- El PIN anterior deja de funcionar.

### RQ-505 — La dueña no se puede dejar afuera

Fuente: `PLAN §5g`, consecuencia operativa de RQ-503.

- Un `ADMIN` no puede desactivarse a sí mismo.
- No se puede desactivar ni cambiar de rol al **último `ADMIN` activo** del local.

Motivo: sin esta regla, un clic deja el sistema sin nadie que pueda confirmar
pagos ni reactivar usuarios. El arreglo requeriría intervención en la base de
datos, o sea llamar al programador un sábado a mediodía.

Aceptación:
- Con un solo ADMIN activo, intentar desactivarlo devuelve 409 con el motivo.
- Con dos ADMIN, desactivar uno funciona.
- Un ADMIN no puede cambiarse el rol a sí mismo a CAJA si es el único.

### RQ-506 — Cada cambio de permisos queda auditado

Fuente: `REPORTE C-02`, D-07, `PLAN §5c`.

Todo cambio sobre un usuario escribe una fila en `AuditLog` con:
- `userId` — quién hizo el cambio.
- `targetUserId` — a quién se lo hizo. La columna se agregó en B2 justamente
  para esto (`REPORTE C-02`).
- Acción: `USUARIO_CREADO`, `USUARIO_DESACTIVADO`, `USUARIO_REACTIVADO`,
  `ROL_CAMBIADO`, `PIN_RESETEADO`.
- Detalle con el valor anterior y el nuevo cuando aplique.

**Dentro de la misma transacción que el cambio** (D-07, igual que la auditoría
financiera). No por listener post-commit.

Motivo: si no se registra quién habilitó a quién, el log de cobros pierde la
mitad de su valor. Saber que "María confirmó el pedido #47" sirve de poco si no
se puede responder "¿y quién le dio permiso a María, y cuándo?". Ese era
exactamente el hueco que señaló `C-02`.

Aceptación:
- Desactivar a una cajera deja una fila con el `targetUserId` correcto.
- Fallar la transacción no deja ni el cambio ni la fila.
- `GET /admin/audit` de B10 puede filtrar por `targetUserId`.

### RQ-507 — Cambiar el PIN propio

Fuente: RQ-111, ya implementado en B3.

Ya existe desde B3: `POST /auth/cambiar-pin`, pide el PIN actual, valida la forma
del nuevo, invalida sesiones. **No se reimplementa.** Se lista acá para que la
pantalla F9 lo exponga y para dejar claro que un usuario cualquiera puede cambiar
su propio PIN sin ser ADMIN.

---

## F9 — Pantalla de usuarios

2 jornadas. Fuente: `PLAN §3` (`/admin` en navegador), `PLAN §7`.

### RQ-508 — Lista de usuarios en el panel

Fuente: `PLAN §3`, `PLAN §7`.

- Dentro de `/admin`, accesible solo con rol `ADMIN`.
- Funciona en el navegador del celular de la dueña: la va a usar desde el
  teléfono, no sentada frente a una computadora (`PLAN §3`).
- Muestra nombre, rol y estado. Los inactivos visualmente diferenciados.

### RQ-509 — Acciones con confirmación explícita

Fuente: `PLAN §7` (mismo criterio que el panel de cobro, `PLAN §5b`).

- Dar de alta, desactivar, reactivar, cambiar rol, resetear PIN.
- **Desactivar y resetear PIN piden confirmación en un diálogo** que diga qué va
  a pasar: "María no va a poder entrar al sistema hasta que la reactives".
- Nunca un botón suelto que ejecute una acción irreversible al primer toque.

Es el mismo criterio que `PLAN §5b` aplica al panel de cobro: "si el panel es una
lista de pedidos con botones verdes, los va a tocar con la fila de gente
mirándola". Acá el riesgo es menor pero el principio es igual — una lista de
personas con un botón rojo al lado invita al accidente.

### RQ-510 — Teclado numérico para el PIN

Fuente: `PLAN §7` (teclado numérico grande), RQ-112.

- El campo de PIN usa teclado numérico, no el alfabético del sistema.
- Muestra cuántos dígitos faltan según el rol elegido: 6 para ADMIN y CAJA, 4
  para COCINA.
- Indica por qué un PIN fue rechazado: "muy corto", "demasiado obvio", "ya está
  en uso". Un "PIN inválido" genérico la deja sin saber qué corregir.

---

## Qué se demuestra al cerrar S5

1. La dueña entra a `/admin/usuarios` desde su celular.
2. Da de alta a una cajera nueva con un PIN de 6 dígitos.
3. La cajera entra desde su propio celular y confirma un pago.
4. La dueña la desactiva. En el siguiente request, la cajera queda afuera — sin
   esperar a que venza su sesión.
5. La dueña la reactiva y la cajera vuelve a entrar con el mismo PIN.
6. La dueña le cambia el rol a COCINA: el panel de cobro deja de estar
   disponible para ella.
7. La dueña le resetea el PIN y se lo comunica verbalmente. El anterior ya no
   funciona.
8. Intenta desactivarse a sí misma: el sistema lo rechaza explicando por qué.
9. Intenta crear a alguien con el PIN de la cocinera: rechazado, sin revelar de
   quién era.
10. En `/admin/audit` aparecen las seis acciones anteriores con quién, a quién y
    cuándo.

---

## Tests de este sprint

**Integración, con DB:**
- Crear usuario con PIN duplicado de un activo: rechazado.
- Crear usuario con PIN duplicado de un **inactivo**: permitido (su PIN ya no
  compite en el login).
- `CAJA` con 4 dígitos: rechazado. `COCINA` con 4: aceptado.
- PIN obvio (`1234`, `111111`): rechazado.
- Desactivar e intentar login: rechazado.
- **Revocación en vivo**: obtener token, desactivar al usuario, usar el token →
  401. Es el test que prueba RQ-503.
- Cambiar rol y verificar que el guard del endpoint de cobro ya responde 403 con
  el token viejo.
- Resetear PIN: el anterior falla, el nuevo funciona.
- Último ADMIN: no se puede desactivar ni cambiar de rol.
- Penúltimo ADMIN: sí se puede.
- Cada acción deja fila de auditoría con `targetUserId` correcto.
- Atomicidad: fallar la transacción no deja ni cambio ni auditoría.
- La respuesta de `GET /admin/users` no contiene `pinHash`.

**Unitarios:**
- Ya cubiertos en B3: `validarFormaPin`, `largoMinimoParaRol`, hash y
  verificación. No se duplican.

---

## Fuera de alcance en S5

- **Multi-local.** Un usuario pertenece a un `locationId` y no se mueve entre
  locales. `PLAN §4` dejó la columna preparada, pero la gestión multi-local no es
  del MVP.
- **Permisos granulares.** Hay tres roles fijos: `ADMIN`, `CAJA`, `COCINA`
  (`PLAN §5g`). No se construye un sistema de permisos por acción. Si la dueña
  más adelante quiere "una cajera que confirme pero no cancele", eso es v2.
- **Recuperación de PIN por el propio usuario.** No existe y es deliberado
  (D-03): no hay email, el servidor está en la LAN. El reset lo hace ADMIN.
- **Historial de sesiones.** Saber desde qué dispositivo entró cada uno sería
  útil pero no está pedido. `LoginAttempt` de B3 ya guarda el origen de los
  intentos fallidos, que es lo que importa para seguridad.
- **Autenticación de dos factores.** Fuera de escala para un restaurante en LAN.

---

## Riesgos

**Que la dueña comparta su PIN con la cajera "por esta vez".** Es el riesgo real
de este sprint y es social, no técnico. Si lo hace, toda la auditoría de cobros
se vuelve inútil: el log diría que confirmó ella. Mitigación parcial: que dar de
alta a alguien sea tan rápido que no haya excusa para compartir. Si crear una
cajera toma tres toques, el atajo deja de ser atractivo. Fuente del principio:
`PLAN §5g`.

**Que el PIN duplicado se descubra tarde.** Si dos personas terminan con el mismo
PIN por algún camino no cubierto, el login de ambas falla y nadie entiende por
qué. B3 ya rechaza el login ambiguo con un mensaje explícito ("ese PIN está
asignado a más de una persona, avisá a la dueña"), y RQ-502 lo impide en la
creación. Pero conviene una consulta de diagnóstico que liste colisiones, para
poder arreglarlo sin adivinar.

**Que desactivar a alguien rompa datos históricos.** No debería: `Order.
confirmadoPorId` referencia al usuario y la fila sigue existiendo. Un usuario
desactivado conserva su historial. Pero hay que verificar explícitamente que
`GET /admin/audit` siga mostrando el nombre de una persona desactivada — si el
join la filtrara, los cobros viejos quedarían sin autor visible.

**Que la pantalla se construya pensada para computadora.** La dueña va a usar
esto desde el celular (`PLAN §3`). Una tabla de usuarios con cinco columnas y
botones chicos es inusable con el pulgar. Mitigación: aplicar los criterios de
tamaño de `PLAN §7` también acá, aunque estén escritos pensando en el kiosco.
