/**
 * RQ-310 — Fecha de jornada.
 *
 * Fuente: `PLAN §4`, `PLAN §5e` regla 5, **D-14**, `REPORTE SIS-02`.
 *
 * Función pura: no toca Prisma ni Nest (`ARQUITECTURA §2`).
 *
 * D-14 cerró la regla 5: la jornada va de las 05:00 a las 05:00 del día
 * siguiente, y un pedido cuenta en el día en que se **pagó**.
 *
 * Ese "cuenta en el día en que se pagó" es del CIERRE (B12, S9), que agrupa por
 * `pagadoEn`. Acá se calcula la jornada de CREACIÓN, que es otra cosa y hace
 * falta antes: el número de pedido es único por `(fecha, locationId)` y se
 * asigna cuando el pedido nace, cuando todavía no hay pago.
 *
 * Los dos conceptos conviven a propósito. `Order.fecha` es la jornada de
 * creación y sirve para numerar; el cierre usa `pagadoEn`. Confundirlos haría
 * que el cuadre no coincida con el extracto bancario.
 */

/** Hora de corte por defecto. El valor real sale de `Setting` (RQ-109). */
export const HORA_CORTE_POR_DEFECTO = 5;

/**
 * Devuelve la jornada a la que pertenece un instante dado.
 *
 * Con corte a las 05:00, lo que pasa a las 02:00 del día 15 pertenece a la
 * jornada del 14: es el mismo servicio de noche que empezó el 14 a las 20:00.
 *
 * Se devuelve a medianoche UTC porque la columna es `@db.Date` y Prisma
 * normaliza así; lo que importa es la fecha, no la hora.
 */
export function jornadaDe(
  instante: Date,
  horaCorte: number = HORA_CORTE_POR_DEFECTO,
): Date {
  if (!Number.isInteger(horaCorte) || horaCorte < 0 || horaCorte > 23) {
    throw new Error(
      `Hora de corte inválida: ${horaCorte}. Debe ser un entero de 0 a 23.`,
    );
  }

  const y = instante.getFullYear();
  const m = instante.getMonth();
  const d = instante.getDate();

  // Antes del corte, la jornada es la del día anterior.
  const dia = instante.getHours() < horaCorte ? d - 1 : d;

  // Date normaliza el día 0 al último del mes anterior, así que los cambios de
  // mes y de año no necesitan tratamiento aparte.
  const jornada = new Date(y, m, dia);
  return new Date(
    Date.UTC(jornada.getFullYear(), jornada.getMonth(), jornada.getDate()),
  );
}

/** `true` si los dos instantes caen en la misma jornada. */
export function mismaJornada(
  a: Date,
  b: Date,
  horaCorte: number = HORA_CORTE_POR_DEFECTO,
): boolean {
  return jornadaDe(a, horaCorte).getTime() === jornadaDe(b, horaCorte).getTime();
}
