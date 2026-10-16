# Módulos y sprints

Complementa `PLAN.md` y `ARQUITECTURA.md`.

---

## 0. Sobre el multi-sucursal

Dijiste "supongo que sí", y eso no alcanza para construirlo. Multi-tenancy real
no es agregar una columna: es `locationId` en todas las tablas y todas las
queries, catálogo y precios por local, QR por local, usuarios asignados a un
local, reportes por local y consolidados. Son unas **12-15 jornadas** de trabajo
y toca cada módulo.

Hacerlo sobre un "supongo" es construir para un futuro que puede no llegar.
Saltearlo del todo es pagar una migración dolorosa si llega.

**Lo que hacemos (≈1 jornada):**

- `Location` existe como tabla, con **una fila** sembrada
- `locationId` en `Order`, `PaymentQr` y `User`, siempre poblada con esa fila
- Número de pedido único por **(fecha, locationId)**, no global
- Configuración en tabla, no en `.env`
- Ninguna query sin filtro de contexto

Con eso, el día que haya un segundo local el trabajo es UI de selección y
reportes consolidados — no una migración de esquema con datos en producción.

**Lo que NO hacemos ahora:** selector de local en la UI, precios por local,
permisos por local, reportes consolidados.

Si en algún momento pasa de "supongo" a "sí, en marzo abrimos", decímelo y lo
replanificamos. Es una conversación de 10 minutos ahora y una semana de trabajo
después.

---

## 1. Los módulos

**19 módulos** en cuatro grupos. La estimación está en **jornadas ideales de un
dev** que ya conoce el stack.

### Backend — base (12 j)

| # | Módulo | Qué incluye | j |
|---|---|---|---|
| B1 | `shared` (kernel) | `Money`, `Result`, tabla de transiciones, schemas Zod, tipos | 3 |
| B2 | `infra` | Prisma, esquema completo, migraciones, docker-compose, config, seed | 4 |
| B3 | `auth` | Login por PIN, argon2, JWT, guards, roles | 3 |
| B4 | `locations` | Tabla, contexto, scoping (§0) | 1 |
| B5 | `settings` | Horario de corte, timeout de pago, en tabla | 1 |

### Backend — dominio (24 j)

| # | Módulo | Qué incluye | j |
|---|---|---|---|
| B6 | `catalog` | CRUD categorías/platos/variantes, activar, reordenar, subida de fotos | 4 |
| B7 | `orders` | Creación, numeración transaccional, idempotencia por UUID, máquina de estados, cálculo de total | 6 |
| B8 | `payments` | CRUD de QR, activar/archivar, pool de sufijos, confirmación, camino de discrepancia | 6 |
| B9 | `kitchen` | Cola, avance de estados, reconstrucción por HTTP | 2 |
| B10 | `audit` | Log de confirmaciones, cancelaciones, precios, cambios de QR | 2 |
| B11 | `realtime` | Gateway WebSocket, namespaces por rol, eventos post-commit | 3 |
| B12 | `reports` | Ventas del día, cuadre de cierre desglosado por QR | 3 |

B7 y B8 son el corazón del sistema y donde está casi todo el riesgo técnico.

### Frontend (36 j)

| # | Módulo | Qué incluye | j |
|---|---|---|---|
| F1 | `shared/ui` + `api` | Tokens, Button/Card/Price, cliente HTTP con reintentos, offline, hooks de WS | 5 |
| F2 | Kiosco — catálogo y carrito | Grid con fotos, categorías, carrito persistente, +/− | 10 |
| F3 | Kiosco — checkout y pago | Nombre, aquí/llevar, pantalla de QR con monto, espera, auto-reset, idempotencia | — |
| F4 | Admin — pagos | Buscador por monto con foco, cola, confirmar con diferencia | 5 |
| F5 | Admin — menú | Precio editable en fila, switch activo, fotos desde cámara, reordenar | 7 |
| F6 | Admin — cobro | Gestión de QR, cuadre por QR | 3 |
| F7 | KDS cocina | Tablero por estado, tiempos, avance por toque | 4 |
| F8 | Pantalla de listos | Vista pública de números listos | 2 |

> F2 y F3 comparten las 10 jornadas: son un solo flujo partido en dos entregas.

El frontend pesa más que el backend. Es lo esperable: son tres superficies con
requisitos de UI distintos, y el kiosco tiene que funcionar con gente apurada que
nunca vio el sistema.

### Operación (10 j)

| # | Módulo | Qué incluye | j |
|---|---|---|---|
| O1 | Modo kiosco Android | Screen pinning, build EAS, instalación en la tablet | 3 |
| O2 | Backups y runbook | `pg_dump` automático, restauración probada, guía para la dueña | 2 |
| O3 | Endurecimiento | Rate limit en login, revisión de permisos, validaciones | 2 |
| O4 | Prueba en el local | La dueña y cocina usándolo, ajustes de lo que salga | 3 |

**Total ≈ 82 jornadas ideales.**

---

## 2. Sprints

Sprints de 2 semanas. Cada uno cierra con algo demostrable, no con "la capa de
servicios terminada".

| Sprint | Foco | Módulos | Se puede demostrar |
|---|---|---|---|
| **S1** | Cimientos | B1, B2, B3, B4 | API arranca, login por PIN, catálogo sembrado consultable |
| **S2** | Pedidos | B6, B7 | Crear un pedido por HTTP: número, sufijo único, total correcto, transiciones validadas |
| **S3** | Pagos | B8, B10, B11 | Confirmar un pago por monto y ver el evento llegar por WebSocket |
| **S4** | Kiosco I | F1, F2 | Armar un carrito en la tablet con fotos y categorías |
| **S5** | Kiosco II | F3 | **Pedido completo desde la tablet**: carrito → nombre → QR con monto → pantalla de espera |
| **S6** | Panel de la dueña | F4, F6 | Ciclo cerrado: pedido en tablet → la dueña lo confirma buscando por monto |
| **S7** | Menú y cocina | F5, B9, F7 | **El restaurante ya podría operar.** La dueña gestiona su carta, cocina ve los pedidos |
| **S8** | Cierre | B5, B12, F8 | Cuadre del día por QR, log de auditoría, pantalla de listos |
| **S9** | Puesta en marcha | O1, O2, O3, O4 | Tablet en modo kiosco, backups corriendo, probado en el local |

### El hito que importa

**Fin de S7 = sistema operable.** Ahí el restaurante puede empezar a usarlo de
verdad. S8 y S9 agregan control y robustez, pero no son requisito para vender el
primer plato.

Si querés adelantar ese hito, lo que se puede recortar sin romper nada:
- **F8** (pantalla de listos): se grita el número mientras tanto
- **B12** (cuadre): la dueña ya tiene su app bancaria
- **F6** (gestión de QR): se siembra uno en la base y se construye después

Eso adelanta el hito a fin de S6. Lo que **no** se puede recortar: idempotencia,
pool de sufijos, auditoría y backups. Son los que generan pérdida de dinero o de
datos si faltan.

### Cuánto tiempo es

82 jornadas ideales no son 82 días de calendario. Con reuniones, bugs, revisiones
y la fricción normal, contá **60-70% de eficiencia**:

| Equipo | Calendario estimado |
|---|---|
| 1 dev full-time | 9 sprints ≈ **4,5 meses** |
| 2 devs (uno API, uno app) | 5-6 sprints ≈ **2,5-3 meses** |
| 1 dev medio tiempo | 16-18 sprints ≈ **8-9 meses** |

Con 2 devs el reparto natural es B1-B12 para uno y F1-F8 para el otro, con el
contrato de API acordado en S1. No baja a la mitad porque hay dependencias: el
frontend de pagos necesita B8 andando.

**Qué tan confiable es esto:** las estimaciones de backend son razonablemente
firmes porque el dominio está definido. Las de frontend son las más inciertas —
el kiosco se va a rehacer al menos una vez cuando lo pruebe gente real, y eso
está dentro de O4 pero puede desbordar. Si algo se corre, va a ser F2/F3.

---

## 3. Dependencias

```
B1 ──► B2 ──► B3 ──► B4
         │
         ├──► B6 ──┐
         │         ├──► B7 ──► B8 ──► B10
         │                      │
         │                      └──► B11 ──► B9
         │                                    │
         └──► B5 ──────────────────► B12 ◄───┘

F1 ──► F2 ──► F3        (F1 puede arrancar con la API mockeada)
   ├──► F4  (necesita B8)
   ├──► F5  (necesita B6)
   ├──► F6  (necesita B8)
   ├──► F7  (necesita B9 + B11)
   └──► F8  (necesita B9)
```

El camino crítico es **B1 → B2 → B7 → B8 → F4**: la cadena de verificación de
pago. Es lo que no puede atrasarse sin mover todo.

F1 se puede arrancar en paralelo desde S1 contra una API mockeada, y es lo que
permite comprimir con dos devs.
