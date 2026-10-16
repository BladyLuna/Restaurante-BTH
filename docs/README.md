# Base de conocimiento — Sistema de pedidos del restaurante

Punto de entrada. Si entrás al proyecto por primera vez, leé esto completo antes
de tocar nada.

Última actualización: 2026-10-16

---

## Qué es este proyecto

Kiosco de autoservicio para un restaurante en Cochabamba, Bolivia. El cliente
pide en una tablet puesta en la entrada, paga escaneando un QR estático con su
app bancaria, y una persona del local (la dueña o una cajera) confirma que el
pago entró antes de que cocina empiece a preparar.

Etapa actual: **planificación cerrada, desarrollo de cimientos habilitado.**
No hay código todavía.

---

## La restricción que define todo

El QR es **estático** — el QR personal de la dueña. No hay integración bancaria,
ni webhook, ni API del banco. Eso significa que:

> **El sistema no sabe si entró un pago.** Nadie le avisa. La única fuente de
> verdad sobre un abono es el extracto de la cuenta bancaria.

De ahí sale la regla central del sistema, y no se negocia:

> **Un pago se confirma porque se vio el abono en la app bancaria. Nunca porque
> el cliente lo diga, nunca porque muestre una captura.**

Todo el diseño del panel de cobro existe para empujar a ese hábito. Si alguna
propuesta hace más fácil confirmar sin mirar el banco, esa propuesta está mal,
aunque parezca más cómoda.

---

## Mapa de documentos

Leer en este orden la primera vez:

| Documento | Qué contiene | Cuándo consultarlo |
|---|---|---|
| `docs/README.md` | Este archivo. Orientación general | Primero |
| `PLAN.md` | Producto, modelo de datos, flujo, políticas, API, UI | Fuente de verdad del **qué** |
| `ARQUITECTURA.md` | Vertical slices, eventos, patrones, testing | Fuente de verdad del **cómo** |
| `MODULOS.md` | Módulos, estimaciones, sprints, dependencias | Planificación |
| `REPORTE_LOGICA_NEGOCIO.md` | Análisis crítico, hallazgos, casos de uso por actor | Antes de tocar pagos |
| `PREGUNTAS_PARA_LA_DUENA.txt` | Preguntas y políticas en lenguaje llano | Para la dueña |
| `docs/sprints/` | Requerimientos ejecutables sprint por sprint | Durante el desarrollo |
| `docs/modulos/` | Ficha técnica de cada módulo | Al implementar uno |
| `docs/decisiones/` | Registro de decisiones y su motivo | Cuando algo no se entiende |

**Precedencia cuando hay contradicción:**

```
REPORTE §16 (alcance cerrado)  →  PLAN.md  →  ARQUITECTURA.md  →  MODULOS.md
```

El reporte §16 manda porque recoge las decisiones más recientes. Si encontrás una
contradicción que no esté resuelta ahí, no la resuelvas por tu cuenta: anotala y
preguntá.

---

## Los actores

| Actor | Dónde | Login | Qué hace |
|---|---|---|---|
| Cliente | Tablet de la entrada (`/kiosk`) | Ninguno | Arma el pedido y paga por fuera del sistema |
| COCINA | Navegador en cocina (`/kds`) | PIN 4+ | Prepara y entrega lo que ya está pagado |
| CAJA | Su laptop o celular (`/admin`) | PIN 6 | Confirma pagos de monto coincidente |
| ADMIN (dueña) | Su celular o PC (`/admin`) | PIN 6 | Todo: catálogo, QR, diferencias, cancelaciones, usuarios, cierre |
| Banco | Externo | — | Recibe el pago. Sin integración |

El **celular del negocio** con la banca móvil de la dueña abierta está fuera del
sistema: es un activo físico, como la tablet. Es lo que permite que CAJA verifique
sin tener la cuenta a su nombre.

---

## El flujo, de punta a punta

```
   Cliente en la tablet
        │
        │ arma carrito, nombre, aquí/llevar
        ▼
   PENDIENTE_PAGO ──────── se muestra QR + monto + número
        │
        │ el cliente paga desde SU app bancaria (fuera del sistema)
        │ CAJA o ADMIN ve el abono en el celular del negocio
        │ busca el pedido por monto y nombre, y confirma
        ▼
   PAGADO ─────────────── entra a cocina por WebSocket
        │
        ▼
   EN_PREPARACION
        │
        ▼
   LISTO ──────────────── se canta el número
        │
        ▼
   ENTREGADO

   Desde PENDIENTE_PAGO: expira a los 15 min → CANCELADO
   Desde PAGADO: solo ADMIN cancela → CANCELADO + Refund pendiente
```

Lo que nunca puede pasar: que un pedido en `PENDIENTE_PAGO` llegue a cocina. Es
el punto de todo el diseño.

---

## Stack

```
Monorepo
├── apps/api/     NestJS + Prisma + PostgreSQL + Socket.IO
├── apps/app/     Expo (Expo Router) → Android nativo (kiosco) + web (paneles)
└── packages/shared/   tipos, Zod, Money, máquina de estados
```

Todo corre en la **LAN del local**: un PC con la API y Postgres, la tablet por
WiFi. Un corte de internet no frena las ventas, pero exige backups locales.

Consecuencia que se olvida fácil: **no hay correo saliente.** Por eso el login es
por PIN y no por email con recuperación de contraseña.

---

## Decisiones que no se vuelven a discutir

Cerradas el 2026-10-16. El detalle y el motivo están en `docs/decisiones/`.

| # | Decisión |
|---|---|
| D-01 | QR estático administrable. **Cero integración bancaria** en el MVP |
| D-02 | Rol `CAJA` aprobado: confirma montos coincidentes, no diferencias ni cancelaciones |
| D-03 | CAJA verifica mirando un celular del negocio con la banca móvil de la dueña |
| D-04 | **Precios en bolivianos enteros.** El sufijo de centavos queda derogado |
| D-05 | Comprobante del cliente solo ante conflicto, como evidencia, nunca como autorización |
| D-06 | Login por PIN. 6 dígitos para quien confirma pagos. Rate limit desde S1 |
| D-07 | `AuditLog` financiero se escribe **dentro de la transacción**, no por evento |
| D-08 | La imagen de un `PaymentQr` ya usado es inmutable |
| D-09 | Cancelar no reembolsa: genera un `Refund` pendiente que una persona cierra |
| D-10 | Cada superficie en su dispositivo. El personal no toca la tablet del kiosco |

---

## Riesgos aceptados conscientemente

No son bugs ni cosas por resolver: son límites conocidos del MVP. Hay que
escribirlos así en cualquier informe, y no presentarlos como resueltos.

**R-01 — Emparejamiento débil entre abono y pedido.**
Al derogar el sufijo de centavos (D-04), dos pedidos abiertos pueden tener el
mismo total. Un abono de ese monto no identifica unívocamente su pedido. Quedan
abiertos tres de los cuatro vectores de fraude de `PLAN §5b`.
Mitigación: nombre (señal blanda), ventana de 15 min, cola visible y
**desambiguación obligatoria por nombre** cuando hay montos iguales abiertos.
Salida real: QR dinámico en v2.

**R-02 — La cajera podría transferir desde el celular prestado.**
Una app de banca móvil ya autenticada normalmente permite mover plata. "No puede
transferir" **no está garantizado por el software**. Depende del banco.
Mitigación, toda fuera del sistema: probar si transferir pide clave de nuevo;
si no, usar una cuenta dedicada con saldo bajo barrida al cierre; preferir acceso
de solo consulta.

**R-03 — La captura de pantalla no prueba nada.**
Por eso el comprobante es evidencia y no autorización (D-05).

---

## Estado del desarrollo

### Se puede empezar ya

| Módulo | Jornadas | Qué es |
|---|---|---|
| `B1 shared` | 3 | Money, Result, transiciones, Zod |
| `B2 infra` | 4 | Prisma, esquema, migraciones, docker, seed |
| `B3 auth` | 3 | PIN, argon2, JWT, guards, rate limit |
| `B4 locations` | 1 | Tabla y scoping |
| `B6 catalog` | 4 | CRUD platos, variantes, fotos |
| `F1 shared/ui` | 5 | Tokens, apiClient, hooks (API mockeada) |

Ninguno depende de decisiones abiertas. Son ~20 jornadas de trabajo real.

### Bloqueado hasta que responda la dueña

`B7 orders` y `B8 payments` — el corazón del sistema y donde está casi todo el
riesgo. Faltan:

1. Acceso de consulta bancaria para CAJA (preguntas 1, 2, 3 del .txt)
2. Las siete políticas financieras de `PLAN §5e`
3. Política de pago tardío

### Pendientes técnicos propios

- `H08` — liberación de la tablet entre clientes (decisión de UI, requisito de F3)
- `H14` — plato pagado que cocina no puede preparar (falta el flujo)
- `H13` — backups (`O2`) siguen en S9, después del hito operable de S7. **Hay que
  adelantarlos**: no se cobra plata real sin respaldo probado
- `H12` — el conteo de módulos de `MODULOS.md` es inconsistente (declara 19,
  enumera 24, y ahora hay más). Recalcular

---

## Reglas de trabajo

1. **No inventar reglas de negocio.** Si el documento no lo dice, está pendiente.
   Anotalo y preguntá; no lo resuelvas escribiendo código.
2. **La autorización se valida en el servidor.** Ocultar un botón no es un
   permiso.
3. **El total se recalcula siempre en el servidor.** Nunca se confía en lo que
   manda la tablet.
4. **Dinero en centavos enteros**, múltiplos de 100. Nunca `Float`.
5. **Auditoría financiera dentro de la transacción.** Si falla, falla todo junto.
6. **Nada de borrados físicos** de productos, QR ni usuarios. Desactivar o
   archivar.
7. **Un PIN por persona.** Sin eso, el log de auditoría no prueba nada.
8. Cuando una decisión se cierre, **actualizar el documento antes de codificar**.
   Un documento que miente es peor que no tenerlo.
