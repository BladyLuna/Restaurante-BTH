/**
 * Cálculo del total de un pedido. Función pura.
 *
 * Fuente: PLAN §4 (snapshot de precios, dinero), PLAN §6 ("el total se
 *         recalcula siempre en el servidor"), ARQUITECTURA §2 (domain/ de
 *         orders), D-04 (precios enteros).
 *
 * Regla que esto hace cumplir: el cliente usa esta función para MOSTRAR el
 * total, nunca para decidirlo. La función es la misma, la autoridad es del
 * servidor (ARQUITECTURA §6).
 *
 * Nota sobre el sufijo de centavos: NO existe. Fue derogado (D-04). El total
 * iguala al subtotal. Se mantienen los dos conceptos separados porque el cierre
 * los reporta por separado (PLAN §4).
 */

import { type Money, ZERO, add, multiply, sum } from '../money/money.js';
import { type Result, ok, err } from '../result/result.js';

/**
 * Una línea del pedido tal como se calcula. Los precios vienen del snapshot:
 * si la dueña cambia el precio de un plato a mitad del día, los pedidos ya
 * hechos no se alteran (PLAN §4).
 */
export type LineaCalculo = {
  readonly precioUnitario: Money;
  readonly cantidad: number;
};

export type ErrorCalculo =
  | { tipo: 'carrito_vacio' }
  | { tipo: 'cantidad_invalida'; indice: number; cantidad: number }
  | { tipo: 'cantidad_excede_maximo'; indice: number; cantidad: number };

/**
 * Máximo de unidades por línea. No está en PLAN.md: REPORTE CLI-02 lo marca
 * como pendiente ("límites de cantidad y texto"). Se pone un techo defensivo
 * para que un bug del cliente no cree un pedido de 9999 platos; el valor
 * definitivo lo decide la dueña.
 */
export const CANTIDAD_MAXIMA_POR_LINEA = 50;

export type TotalPedido = {
  readonly subtotal: Money;
  readonly total: Money;
};

export function calcularLinea(
  linea: LineaCalculo,
): Result<Money, ErrorCalculo> {
  if (!Number.isInteger(linea.cantidad) || linea.cantidad < 1) {
    return err({
      tipo: 'cantidad_invalida',
      indice: 0,
      cantidad: linea.cantidad,
    });
  }
  return ok(multiply(linea.precioUnitario, linea.cantidad));
}

/**
 * Calcula el total de un pedido. Rechaza carrito vacío y cantidades inválidas
 * en el servidor, no solo en la UI (REPORTE CLI-02: "cantidad inválida y
 * variante ajena al producto deben rechazarse en servidor").
 */
export function calcularTotal(
  lineas: readonly LineaCalculo[],
): Result<TotalPedido, ErrorCalculo> {
  if (lineas.length === 0) {
    return err({ tipo: 'carrito_vacio' });
  }

  const importes: Money[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    if (linea === undefined) continue;

    if (!Number.isInteger(linea.cantidad) || linea.cantidad < 1) {
      return err({
        tipo: 'cantidad_invalida',
        indice: i,
        cantidad: linea.cantidad,
      });
    }
    if (linea.cantidad > CANTIDAD_MAXIMA_POR_LINEA) {
      return err({
        tipo: 'cantidad_excede_maximo',
        indice: i,
        cantidad: linea.cantidad,
      });
    }

    importes.push(multiply(linea.precioUnitario, linea.cantidad));
  }

  const subtotal = sum(importes);

  // D-04: sin sufijo de centavos, el total iguala al subtotal.
  return ok({ subtotal, total: subtotal });
}

export function describirErrorCalculo(error: ErrorCalculo): string {
  switch (error.tipo) {
    case 'carrito_vacio':
      return 'El carrito está vacío';
    case 'cantidad_invalida':
      return `Cantidad inválida en la línea ${error.indice + 1}: ${error.cantidad}`;
    case 'cantidad_excede_maximo':
      return `La línea ${error.indice + 1} pide ${error.cantidad} unidades, el máximo es ${CANTIDAD_MAXIMA_POR_LINEA}`;
  }
}

export { ZERO, add };
