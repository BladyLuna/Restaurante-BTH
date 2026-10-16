# S1 — Cimientos

**Módulos:** B1 `shared`, B2 `infra`, B3 `auth`, B4 `locations`
**Estimación:** 11 jornadas + 0,5 (rate limit adelantado) + 0,5 (guard contra base)
**Estado:** listo para ejecutar. No depende de ninguna decisión abierta.

---

## Objetivo

Que la API arranque, que se pueda entrar con un PIN, y que exista el esquema
completo de la base con datos de prueba.

Al cerrar este sprint no hay nada que un cliente pueda ver. Lo que hay es el piso
sobre el que se construye todo lo demás, y las reglas de dominio que después no
se vuelven a tocar.

---

## B1 — `shared` (kernel compartido)

3 jornadas. Fuente: `ARQUITECTURA §6`, `PLAN §4`.

Es el paquete que evita que el frontend y el backend se contradigan. Dos reglas
que no se rompen: cero dependencias de infraestructura (nada de Prisma, Nest ni
React), y entra algo solo si lo necesitan ambos lados.

### RQ-101 — Value object `Money`

Todo el dinero del sistema pasa por acá.

- Entero en **centavos**, nunca `Float`. Bs 45 se guarda como `4500`.
- Tipo propio, de modo que sumar un `Money` a un `number` no compile.
- Formateo a `"Bs 45"` para la UI.
- **Todos los montos son múltiplos de 100** (bolivianos enteros, `PLAN §5b`
  derogación del sufijo). Un constructor que reciba `4542` debe fallar.

Aceptación:
- Sumar, restar y multiplicar por cantidad no pierde precisión.
- Crear un `Money` con un valor no múltiplo de 100 lanza error.
- El formateo nunca muestra centavos.

### RQ-102 — Tabla de transiciones de estado

Fuente: `ARQUITECTURA §4`. Vive acá porque el frontend también necesita saber qué
botones mostrar.

```ts
const TRANSICIONES = {
  PENDIENTE_PAGO:  ['PAGADO', 'CANCELADO'],
  PAGADO:          ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION:  ['LISTO'],
  LISTO:           ['ENTREGADO'],
  ENTREGADO:       [],
  CANCELADO:       [],
}
```

Una sola función pura decide si una transición es válida. Prohibido escribir
`if (order.estado === 'PAGADO')` disperso en controllers.

Aceptación:
- Toda transición que no esté en la tabla es rechazada.
- `ENTREGADO` y `CANCELADO` no tienen salida.
- La función es pura: se testea sin base de datos.

### RQ-103 — `Result` en vez de excepciones para errores de dominio

"Transición inválida" o "plato inactivo" son resultados esperables, no fallas.
Las excepciones quedan para lo que de verdad falla (base caída).

### RQ-104 — Schemas Zod

Validación compartida entre API y cliente. Incluye el rechazo de precios no
múltiplos de 100.

### RQ-105 — Tipos y enums de roles

`ADMIN`, `CAJA`, `COCINA`. Fuente: `PLAN §5g`.

---

## B2 — `infra`

4 jornadas. Fuente: `PLAN §§3, 4`, `ARQUITECTURA §1`.

### RQ-106 — Esquema Prisma completo

Según `PLAN §4`, **con las entidades nuevas**:

```
Category, Product, ProductVariant
Order           (sin sufijoCentavos; total = subtotal)
OrderItem       (con nombreSnapshot y precioUnitarioSnapshot)
PaymentQr
User            (rol, pinHash, activo)
OrderCounter
AuditLog        (con targetUserId)
Refund          (nuevo — D-09)
PaymentProof    (nuevo — D-05)
Setting
Location
```

Cuidados que vienen de decisiones ya tomadas:

- **`Order.sufijoCentavos` NO existe.** Fue derogado (D-04). Si aparece en el
  esquema, es que se copió de la versión vieja del PLAN.
- `AuditLog.targetUserId` es obligatorio tenerlo, aunque todavía no se use:
  es lo que permite auditar permisos (`REPORTE C-02`).
- `Refund` con estado pendiente/cerrado, `autorizadoPorId` y `cerradoPorId`.
  Cancelar no reembolsa (D-09).
- `PaymentProof` atado a `Order`, con `subidoPorId`.
- **Nunca borrados físicos:** `activo`/`archivado` en Product, PaymentQr y User.

### RQ-107 — `locationId` sembrado

Fuente: `MODULOS §0`. Una sola fila de `Location`, y `locationId` poblado en
`Order`, `PaymentQr` y `User`. No se construye multi-tenancy: se deja la puerta
abierta.

Regla: **ninguna query sin filtro de contexto de local.**

### RQ-108 — Numeración diaria

`OrderCounter` con una fila por día y `SELECT ... FOR UPDATE` dentro de la
transacción que crea el pedido. Único por `(fecha, locationId)`.

Se reinicia en `#1` a una hora configurable (propuesto 05:00, no medianoche, para
no cortar un servicio nocturno).

Nota: la implementación de la creación de pedidos es B7. Acá va solo la tabla y
la migración.

### RQ-109 — `docker-compose` y configuración

Postgres 8+, API, volúmenes persistentes. La configuración (horario de corte,
timeout de pago) vive **en tabla `Setting`, no en `.env`** (`ARQUITECTURA §1`).

### RQ-110 — Seed de desarrollo

- Un `Location`.
- Un usuario ADMIN con PIN conocido para desarrollo.
- Un `PaymentQr` activo de prueba.
- 10-15 platos reales con precios enteros, en categorías. Está pendiente que la
  dueña los dé; mientras tanto, datos creíbles inventados.

Aceptación: `docker compose up` deja la base lista y la API respondiendo.

---

## B3 — `auth`

3 jornadas + 1 de adiciones. Fuente: `PLAN §6`, D-06.

### RQ-111 — Login por PIN

- `POST /auth/login` recibe PIN, devuelve JWT.
- PIN hasheado con **argon2**. Nunca se guarda ni se puede leer el PIN en claro.
- **6 dígitos mínimo para ADMIN y CAJA.** 4 admisibles para COCINA.
- Un PIN **por persona**. Sin eso el log de auditoría no prueba nada.

Por qué PIN y no email+contraseña: el servidor vive en la LAN (`PLAN §3`), así que
recuperar contraseña por correo sería inoperable en un corte de internet. Resetear
un PIN desde el panel no depende de nada externo.

### RQ-112 — Rate limit en el login — ADELANTADO

Estaba en `O3`, sprint final. **Se mueve acá** (D-06, `REPORTE H13`).

Motivo: un PIN de 6 dígitos son un millón de combinaciones, pero sin límite de
intentos un script las prueba igual. El rate limit es lo que hace suficiente al
PIN, así que no puede llegar después de que el sistema ya esté cobrando.

Aceptación: tras N intentos fallidos el login se bloquea por un tiempo, y el
evento queda registrado.

### RQ-113 — Guards por rol

- Autorización verificada **en el servidor**. Ocultar un botón no es un permiso
  (`PLAN §5g`).
- Matriz de permisos de `PLAN §5g` como fuente única.

### RQ-114 — Validación de estado y rol contra la base en cada petición

Fuente: `REPORTE C-05`. **Crítico y fácil de pasar por alto.**

El guard no puede confiar solo en lo que dice el JWT. Tiene que verificar contra
la base que el usuario sigue `activo` y que su rol sigue siendo el que el token
afirma.

Por qué: si CAJA usa un dispositivo personal y deja el negocio, conserva la
sesión del navegador. Revocar su permiso tiene que surtir efecto **en el
momento**, no cuando expire el token. Sin esto, una cajera dada de baja podría
seguir confirmando cobros.

Aceptación: desactivar un usuario con sesión abierta hace que su siguiente
petición sea rechazada.

---

## B4 — `locations`

1 jornada. Fuente: `MODULOS §0`.

### RQ-115 — Contexto de local y scoping

Middleware o interceptor que inyecta el `locationId` del contexto, y una
convención de repositorio que impide consultar sin filtrarlo.

Fuera de alcance: selector de local en la UI, precios por local, permisos por
local, reportes consolidados.

---

## Qué se demuestra al cerrar S1

1. `docker compose up` levanta Postgres y la API.
2. `POST /auth/login` con el PIN del seed devuelve un JWT.
3. Un endpoint protegido rechaza una petición sin token y la acepta con token.
4. Desactivar el usuario del seed hace que su token deje de funcionar en la
   siguiente petición.
5. Cinco intentos de login con PIN equivocado bloquean el acceso.
6. La base tiene el esquema completo y el menú de prueba cargado.

---

## Tests de este sprint

Fuente: `ARQUITECTURA §8`. Lo que importa acá es el dominio puro, que se testea
sin base de datos.

Unitarios, sin DB:
- Toda transición inválida de la tabla es rechazada.
- `Money`: suma, multiplicación, formateo, y rechazo de no múltiplos de 100.

Integración, con DB:
- Login correcto e incorrecto.
- Rate limit efectivo.
- Usuario desactivado con token vigente es rechazado.

No se testea el CRUD más allá de un smoke test: es Prisma haciendo lo que Prisma
hace.

---

## Fuera de alcance en S1

- Creación de pedidos (B7)
- Confirmación de pagos (B8)
- Cualquier pantalla (F1 en adelante)
- Gestión de usuarios desde el panel (B13, S5) — en S1 los usuarios salen del seed
- WebSockets (B11)

---

## Riesgos

**Copiar el esquema viejo del PLAN.** `PLAN §4` fue actualizado el 2026-10-16: se
quitó `sufijoCentavos` y se agregaron `Refund`, `PaymentProof` y
`AuditLog.targetUserId`. Si se trabaja de memoria o de una copia vieja, el
esquema sale mal y la migración después duele.

**Dejar el rate limit para después.** Es la tentación clásica ("lo agregamos al
final"). Ya estaba al final en la planificación original y por eso se adelantó
expresamente.

**Sobre-abstraer.** `ARQUITECTURA §4` es explícito: inversión de dependencias
solo en `PaymentProvider`, `ImageStorage` y `TicketPrinter`. Para todo lo demás,
Prisma directo. Un repositorio que solo hace `return prisma.x.findMany()` es
ruido.
