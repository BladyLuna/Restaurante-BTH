# Sprints — índice

Planificación ejecutable. Cada archivo de sprint tiene los requerimientos de sus
módulos, criterios de aceptación y qué se puede demostrar al cerrar.

Sprints de 2 semanas. Cada uno cierra con algo demostrable, no con "la capa de
servicios terminada".

---

## Estado

| Sprint | Foco | Módulos | Estado | Bloqueo |
|---|---|---|---|---|
| [S1](S1-cimientos.md) | Cimientos | B1, B2, B3, B4 | **HECHO** | — |
| [S2](S2-catalogo.md) | Catálogo | B6, F1 | **B6 hecho**, F1 pendiente | — |
| [S3](S3-pedidos.md) | Pedidos | B7 | **Listo para ejecutar** | — |
| [S4](S4-pagos.md) | Pagos y auditoría | B8, B10, B11 | **Listo para ejecutar** | — |
| [S5](S5-usuarios.md) | Usuarios y permisos | B13, F9 | Listo tras B3 | — |
| [S6](S6-kiosco.md) | Kiosco | F2, F3 | Parcial | H08 (liberación de tablet) |
| [S7](S7-panel-cobro.md) | Panel de cobro | F4, F6 | Depende de B8 | — |
| [S8](S8-menu-cocina.md) | Menú y cocina | F5, B9, F7 | Depende de B7, B11 | — |
| [S9](S9-cierre.md) | Cierre y reportes | B5, B12, F8 | Sin documentar | Reglas 2, 3, 6 |
| [S10](S10-puesta-en-marcha.md) | Puesta en marcha | O1, O2, O3, O4 | Sin documentar | Depende de todo |

**Hito operable: fin de S8.** Ahí el restaurante puede empezar a usarlo de verdad.

**Actualización 2026-10-17.** Las decisiones D-11 a D-17 cerraron los bloqueos de
negocio que tenían detenidos S3 y S4. En particular D-15 (CAJA confirma pagos con
acceso de consulta bancaria) abrió el camino crítico completo. Lo que queda
pendiente de la dueña —reglas 2, 3, 6 y 7— afecta a S9, no al desarrollo de
pedidos ni de cobros.

---

## Cambios respecto de `MODULOS.md`

`MODULOS.md` quedó desactualizado por las decisiones del 2026-10-16. Diferencias:

**Sale del alcance:**
- Pool de sufijos de centavos en B8 (D-04)
- Segunda implementación de `PaymentProvider` y webhooks (D-01)

**Entra al alcance:**
- `B13 users` — gestión de usuarios y revocación (3 j)
- `F9` — pantalla de usuarios en el panel (2 j)
- `targetUserId` y acciones de permisos en B10 (0,5 j)
- Desglose por operador en B12 (0,5 j)
- Validación de estado y rol contra la base en B3 (0,5 j)
- Desambiguación de montos iguales en B8/F4 (1 j)
- `PaymentProof` — comprobante de conflicto (0,5 j)
- `Refund` — obligación de devolución y su cierre (1 j)

**Se adelanta:**
- Rate limit de login: de O3 (S9) a B3 (S1)
- Backups: de O2 (final) a antes del hito operable

**Reorganización:** `MODULOS.md` metía B6+B7 juntos en un sprint y B8+B10+B11 en
otro. Se separan porque B7 y B8 son los de más riesgo y no conviene comprimirlos.
Se agrega un sprint de usuarios que antes no existía.

El total de jornadas debe recalcularse (`H12`: `MODULOS.md` declara 19 módulos y
enumera 24).

---

## Dependencias

```
B1 ──► B2 ──► B3 ──► B4
         │      │
         │      └──► B13 ──► F9
         │
         ├──► B6 ──► B7 ──► B8 ──► B10
         │                   │
         │                   ├──► B11 ──► B9 ──► F7
         │                   │
         │                   └──► F4 ──► F6
         │
         └──► B5 ──────────────► B12

F1 ──► F2 ──► F3        (F1 arranca con la API mockeada)
```

**Camino crítico: `B1 → B2 → B7 → B8 → F4`.** Es la cadena de verificación de
pago. Lo que no puede atrasarse sin mover todo.

---

## Cómo usar estos documentos

Cada sprint tiene:

- **Objetivo** — qué se logra, en una frase
- **Requerimientos** — con ID (`RQ-xx`), lo que hay que construir
- **Criterios de aceptación** — cómo se sabe que está hecho
- **Qué se demuestra** — lo que se le puede mostrar a alguien al cerrar
- **Fuera de alcance** — lo que NO entra, para que no se cuele
- **Riesgos** — lo que puede salir mal

Los requerimientos citan su fuente (`PLAN §5b`, `ARQUITECTURA §3`, etc). Si un
requerimiento no tiene fuente, es una decisión nueva y hay que registrarla en
`docs/decisiones/` antes de implementarla.
