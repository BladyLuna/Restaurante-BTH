# Arquitectura

Complementa `PLAN.md`. Decisiones de estructura de código, no de producto.

---

## 1. Qué significa "escalable" en este proyecto

Hay que separar dos cosas que la palabra mezcla:

**Escalar en carga** — no es el problema. Un restaurante hace del orden de 100-400
pedidos por día, con picos de tal vez un pedido por minuto a la hora del almuerzo.
Eso lo sirve un Postgres en una PC sin transpirar. Diseñar para throughput acá
sería resolver un problema que no existe, y el costo sería real: cada capa de
indirección que agregás "por si acaso" se paga en cada feature que escribís
después.

**Escalar en cambio** — ese sí es el problema. Lo que va a crecer es:

- Features que hoy están fuera de alcance: pedidos desde el celular, delivery,
  combos, promociones, impresión de tickets
- El cambio de pago manual a **QR dinámico con webhook** (§5d del plan), que es
  el más probable y el que más toca
- Una segunda sucursal, si el negocio va bien
- Gente distinta a la dueña operando el sistema (caja, varios cocineros)

Así que la arquitectura optimiza para **poder cambiar sin romper**, no para
aguantar tráfico. Todo lo que sigue sale de ese criterio.

### La única decisión de escala real: multi-sucursal

Si abre un segundo local, un sistema con el `tenantId` metido después es una
migración dolorosa. Pero construir multi-tenancy ahora es trabajo que
probablemente no se use.

**Decisión intermedia:** no construimos multi-tenancy, pero no nos cerramos la
puerta. Concretamente:

- El número de pedido es único **por día y por local**, no global. Hoy hay un
  local, pero la clave compuesta ya existe conceptualmente.
- Nada de `SELECT` sin filtro en los servicios; siempre se consulta desde el
  contexto del local.
- La configuración (QR activo, horario de corte) vive en tabla, no en `.env`.

Eso deja la puerta abierta sin pagar el costo hoy.

---

## 2. Vertical slices

Sí, vertical. El código se organiza **por feature, no por capa técnica**.

En lugar de esto:

```
src/
├── controllers/     ← todos los controllers de todo el sistema
├── services/
├── repositories/
└── entities/
```

Esto:

```
apps/api/src/
├── modules/
│   ├── catalog/           categorías, platos, variantes
│   ├── orders/            creación, numeración, máquina de estados
│   ├── payments/          confirmación, sufijos de monto, QR
│   ├── kitchen/           cola de cocina, avance de estados
│   ├── reports/           cuadre de cierre, ventas del día
│   ├── auth/              PIN, JWT, guards
│   └── audit/             log de auditoría
├── shared/                kernel: Money, Result, errores, tipos base
└── infra/                 Prisma, WebSocket gateway, storage de imágenes
```

**Por qué.** Una feature se toca completa en un solo lugar. Cuando llegue el QR
dinámico, el cambio vive casi todo en `payments/`. Con capas horizontales ese
mismo cambio te hace abrir cuatro carpetas y adivinar qué más usa el service que
estás tocando.

NestJS ya empuja a esto con sus módulos, así que no estamos peleando contra el
framework.

### Dentro de cada slice

```
orders/
├── orders.controller.ts      HTTP
├── orders.service.ts         orquestación, transacciones
├── orders.repository.ts      acceso a datos (solo si el slice lo necesita)
├── domain/
│   ├── order-state.ts        máquina de estados (función pura)
│   └── order-total.ts        cálculo de total (función pura)
├── dto/
└── orders.module.ts
```

### Profundidad variable — esto importa

**No todos los slices tienen la misma profundidad.** Aplicar la misma plantilla
de 4 capas a todo es el error más común al adoptar esta estructura.

| Slice | Profundidad | Por qué |
|---|---|---|
| `orders`, `payments` | Completa, con `domain/` y repositorio | Tienen reglas reales: transiciones válidas, numeración transaccional, sufijos únicos, cálculo de totales |
| `catalog` | Controller → service → Prisma directo | Es CRUD. Un repositorio acá es una capa que solo reenvía llamadas |
| `reports` | Controller → service con queries | Son lecturas. No hay dominio que proteger |

La regla: **la capa se agrega cuando hay lógica que proteger, no por simetría.**
Si un repositorio solo hace `return prisma.x.findMany()`, es ruido.

### Comunicación entre slices

Dos reglas:

1. **Un slice no importa el service de otro directamente** si puede evitarlo. La
   excepción pragmática: `orders` sí consulta `catalog` para armar el pedido, y
   eso está bien — es una dependencia real del dominio, no acoplamiento
   accidental.
2. **Para efectos secundarios, eventos.** Cuando se confirma un pago, tienen que
   pasar tres cosas: la orden cambia de estado, cocina se entera, y queda un
   registro de auditoría. Si `payments.service` llama a `kitchen` y a `audit`
   directamente, cada efecto nuevo lo vuelve a modificar. Con eventos, `payments`
   emite `OrderPaid` y los otros escuchan.

---

## 3. Eventos de dominio y el detalle que suele salir mal

El patrón es simple: el slice emite un evento, otros reaccionan.

```
payments.service → emite OrderPaid
                   ├── kitchen listener  → push WebSocket al KDS
                   ├── audit listener    → graba en AuditLog
                   └── (futuro) printer  → imprime ticket
```

**El detalle que importa: el evento se emite DESPUÉS del commit, no dentro de la
transacción.** Si emitís adentro y la transacción después falla, la cocina ya
recibió un pedido que en la base no existe. Al revés es recuperable: si el commit
funcionó y el push falló, el KDS lo ve en el próximo refresh.

**Excepción: la auditoría financiera NO va por evento.** La regla de arriba vale
para efectos secundarios recuperables — un push al KDS, una impresión. No vale
para el registro de auditoría de una operación financiera.

Si `AuditLog` se escribe desde un listener posterior al commit, hay una ventana
en la que el pedido ya está `PAGADO` y todavía no existe el registro de quién lo
confirmó. Un reinicio del servidor en esa ventana deja un cobro sin autoría, y
el log deja de ser prueba. Con dos personas habilitadas para confirmar (dueña y
caja), ese es exactamente el dato que no se puede perder.

Por eso:

- La fila de `AuditLog` de una confirmación de pago, una cancelación, un cambio
  de precio o un cambio de QR se escribe **dentro de la misma transacción** que
  el cambio de estado. O quedan las dos cosas, o no queda ninguna.
- El listener posterior al commit se usa para el push al KDS, no para auditar.
- Dicho de otro modo: `payments.service` escribe la orden y su auditoría en una
  sola transacción, y recién después emite `OrderPaid` para que cocina se entere.

Para este sistema un `EventEmitter` en proceso después del commit es suficiente —
es un servidor único en una LAN. **No** hace falta un outbox transaccional con
cola; eso resuelve la entrega garantizada entre procesos distribuidos, que no es
nuestro caso. Pero sí hay que cubrir la falla concreta: si el servidor se reinicia
justo entre el commit y el push, el KDS tiene que poder reconstruir su estado.
Por eso el KDS **siempre consulta `GET /kitchen/orders` al conectarse**, y el
WebSocket es solo para actualizaciones incrementales. Nunca depende solo del push.

---

## 4. SOLID aplicado a casos concretos

SOLID es útil cuando responde a una presión real. Dónde aplica acá:

**SRP — La máquina de estados en un solo lugar.** La tentación es poner `if
(order.estado === 'PAGADO')` en el controller de cocina, otro en el de admin, otro
en el kiosco. Después agregás un estado y hay que encontrar los siete lugares. En
cambio: una tabla de transiciones explícita, y una sola función que decide.

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

Vive en `packages/shared` porque el frontend también necesita saber qué botones
mostrar. Un solo origen de verdad para la regla.

**OCP — `PaymentProvider`.** El caso que ya está en el plan. Pasar de QR estático
a QR dinámico debería agregar una implementación, no modificar el kiosco ni la
cocina.

```ts
interface PaymentProvider {
  prepararPago(order): Promise<DatosDePago>   // qué muestra la tablet
  requiereConfirmacionManual(): boolean        // ¿existe la pantalla de la dueña?
}
```

`QrEstaticoManual` devuelve la imagen del QR activo y el monto con sufijo, y pide
confirmación manual. `QrDinamicoWebhook` devuelve un QR generado con monto
embebido y no pide confirmación. **Esta es la abstracción que más va a pagar**,
porque es el cambio más probable del sistema.

**DIP — solo donde hay una segunda implementación plausible.** Invertir todo
"porque es buena práctica" llena el proyecto de interfaces con un solo
implementador, que no desacoplan nada y solo agregan un salto al leer el código.

Los tres lugares donde sí vale:
- `PaymentProvider` — dos implementaciones, una ya prevista
- `ImageStorage` — disco local hoy, posible S3/Cloudinary mañana
- `TicketPrinter` — no existe aún, y cuando exista no debe tocar `kitchen`

Para todo lo demás, dependé de Prisma directo. Prisma ya es la abstracción de la
base; envolverlo en un repositorio que reenvía llamadas no te da portabilidad
real, solo una capa más.

**ISP** — se resuelve con los módulos: el módulo de cocina no importa nada de
admin. Si `kitchen` necesita algo de `orders`, `orders` expone solo eso.

---

## 5. Patrones que se ganan el lugar

| Patrón | Dónde | Por qué |
|---|---|---|
| **State machine** | Estado del pedido | Una tabla de transiciones en vez de `if`s dispersos |
| **Strategy** | `PaymentProvider` | El cambio más probable del sistema |
| **Snapshot** | `OrderItem` guarda nombre y precio | Cambiar un precio no debe reescribir la historia (§4 del plan) |
| **Result en vez de excepciones** | Errores de dominio | "Transición inválida" o "plato inactivo" son resultados esperables, no excepciones. Las excepciones quedan para fallas reales (DB caída) |
| **Value object `Money`** | Todo el dinero | Entero en centavos, con su propio tipo. Hace imposible sumar un `Money` a un `number` por accidente |
| **Domain events** | Confirmación de pago | §3 |

### Patrones que NO vamos a usar, y por qué

- **CQRS / Event sourcing.** Resuelven lecturas y escrituras con cargas muy
  distintas, o auditoría total reconstruible. Nuestra auditoría es una tabla y
  alcanza.
- **Microservicios.** Un restaurante, un servidor, un equipo. Partirlo agrega
  red, despliegue y debugging distribuido sin ganar nada.
- **DDD completo con agregados y value objects por todas partes.** Tomamos lo que
  sirve (snapshot, eventos, `Money`, dominio puro en orders/payments) y dejamos
  el resto. `Categoria` no necesita ser un agregado con invariantes.
- **Repositorio genérico `BaseRepository<T>`.** Termina siendo un ORM peor que el
  que ya tenemos.

El criterio para agregar cualquier patrón: **nombrá el cambio concreto que te va
a resultar más fácil.** Si no podés nombrarlo, no lo agregues todavía.

---

## 6. El kernel compartido

`packages/shared` es lo que evita que el frontend y el backend se contradigan:

```
shared/
├── money.ts           Money, formateo a "Bs 45,42", parseo
├── order-state.ts     tabla de transiciones + validador
├── schemas/           Zod: valida en la API y tipa el cliente
└── types/
```

Dos reglas para que no se convierta en un basurero:

1. **Cero dependencias de infraestructura.** Nada de Prisma, Nest ni React acá.
   Si no corre en un test unitario sin mocks, no va.
2. **Entra algo solo si el frontend y el backend lo necesitan.** Si solo lo usa
   la API, va en la API.

**El total siempre se recalcula en el servidor.** El cliente usa `Money` para
*mostrar* el total, nunca para decidirlo. Compartir el cálculo no significa
confiar en el cliente: la función es la misma, la autoridad es del servidor.

---

## 7. Frontend

Mismo criterio vertical, y un problema propio: una sola base de código sirve tres
superficies (kiosco, KDS, admin) con requisitos de UI muy distintos.

```
apps/app/
├── app/                      rutas de Expo Router
│   ├── kiosk/
│   ├── kds/
│   └── admin/
├── features/                 catalog/, cart/, orders/, payments/, menu-admin/
├── shared/
│   ├── ui/                   Button, Card, Price — tokens de diseño
│   └── api/                  cliente HTTP + hooks de WebSocket
```

**Lo que se comparte son las features, no las pantallas.** El kiosco necesita
botones de 72 px y el admin una tabla densa en un celular; forzar un componente
común para las dos termina en un componente con diez props condicionales. Se
comparte el estado, los tipos y las llamadas; cada superficie arma su propia UI.

### Dos puntos que definen la robustez del kiosco

**Todo el acceso a red en una capa.** Un `apiClient` único con reintentos,
timeout y detección de offline. Si cada pantalla hace su propio `fetch`, el
manejo de "se cayó el WiFi" queda inconsistente y la tablet se cuelga en silencio
justo cuando hay gente esperando.

**Creación de pedido idempotente.** El cliente genera un UUID para el intento y
lo manda en el `POST`. Si la respuesta se pierde por WiFi y la tablet reintenta,
el servidor reconoce el UUID y devuelve el pedido ya creado en lugar de crear un
segundo. Sin esto, un WiFi inestable genera pedidos duplicados — y con sufijos de
centavos distintos, lo que rompe el cuadre de caja.

---

## 8. Qué se testea

La arquitectura solo sirve si hace testeable lo que importa. El dominio puro es
testeable sin base de datos, y ahí está casi todo el riesgo del sistema:

**Tests unitarios, sin DB:**
- Tabla de transiciones: toda transición inválida debe ser rechazada
- Cálculo de total con variantes y cantidades
- `Money`: redondeo, formateo, suma
- Asignación de sufijos: nunca dos iguales entre pedidos abiertos

**Tests de integración, con DB:**
- Numeración concurrente: dos pedidos simultáneos nunca comparten número
  (`SELECT ... FOR UPDATE`)
- Confirmación de pago: deja la orden en `PAGADO` y una fila en `AuditLog`
- Idempotencia: el mismo UUID dos veces crea un solo pedido

**No testeamos** el CRUD de catálogo más allá de un smoke test. Es Prisma
haciendo lo que Prisma hace.

---

## 9. Resumen de las decisiones

1. Optimizar para **cambio**, no para carga. El tráfico de un restaurante es
   chico; la lista de features no.
2. **Vertical slices** por feature, con **profundidad variable** — capa solo donde
   hay lógica que proteger.
3. **Dominio puro** (estados, totales, dinero) sin dependencias, en funciones
   testeables.
4. **Eventos después del commit**, y el KDS siempre capaz de reconstruir su
   estado por HTTP.
5. **Inversión de dependencias en tres lugares** con segunda implementación
   plausible: pago, storage de imágenes, impresora. En el resto, Prisma directo.
6. **Kernel compartido** sin infraestructura, con la autoridad del cálculo siempre
   en el servidor.
7. **Idempotencia en la creación de pedidos**, porque el WiFi se va a caer.
8. Puerta abierta a multi-sucursal sin construirla.
