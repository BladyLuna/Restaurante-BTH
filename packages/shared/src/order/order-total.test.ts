/**
 * Tests del cálculo de total.
 *
 * Fuente del plan de pruebas: ARQUITECTURA §8 ("cálculo de total con variantes
 * y cantidades").
 */

import { describe, it, expect } from 'vitest';
import { fromBolivianos, toBolivianos } from '../money/money.js';
import { unwrap, isErr } from '../result/result.js';
import {
  calcularTotal,
  CANTIDAD_MAXIMA_POR_LINEA,
  describirErrorCalculo,
  type LineaCalculo,
} from './order-total.js';

const linea = (bs: number, cantidad: number): LineaCalculo => ({
  precioUnitario: fromBolivianos(bs),
  cantidad,
});

describe('cálculo de total', () => {
  it('un solo ítem', () => {
    const t = unwrap(calcularTotal([linea(45, 1)]));
    expect(toBolivianos(t.subtotal)).toBe(45);
    expect(toBolivianos(t.total)).toBe(45);
  });

  it('varias unidades del mismo ítem', () => {
    const t = unwrap(calcularTotal([linea(15, 3)]));
    expect(toBolivianos(t.total)).toBe(45);
  });

  it('varios ítems con cantidades distintas', () => {
    const t = unwrap(
      calcularTotal([linea(15, 2), linea(20, 1), linea(5, 4)]),
    );
    // 30 + 20 + 20
    expect(toBolivianos(t.total)).toBe(70);
  });

  it('el total iguala al subtotal — no hay sufijo de centavos (D-04)', () => {
    const t = unwrap(calcularTotal([linea(45, 1), linea(38, 2)]));
    expect(toBolivianos(t.subtotal)).toBe(toBolivianos(t.total));
  });

  it('el total nunca tiene centavos', () => {
    const t = unwrap(calcularTotal([linea(7, 3), linea(11, 2)]));
    expect(Number.isInteger(toBolivianos(t.total))).toBe(true);
  });
});

describe('validaciones en el servidor — REPORTE CLI-02', () => {
  it('rechaza carrito vacío', () => {
    const r = calcularTotal([]);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.tipo).toBe('carrito_vacio');
  });

  it('rechaza cantidad cero', () => {
    const r = calcularTotal([linea(45, 0)]);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.tipo).toBe('cantidad_invalida');
  });

  it('rechaza cantidad negativa', () => {
    const r = calcularTotal([linea(45, -2)]);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.tipo).toBe('cantidad_invalida');
  });

  it('rechaza cantidad fraccionaria', () => {
    const r = calcularTotal([linea(45, 1.5)]);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.tipo).toBe('cantidad_invalida');
  });

  it('informa en qué línea está el problema', () => {
    const r = calcularTotal([linea(45, 1), linea(20, 0), linea(10, 2)]);
    expect(isErr(r)).toBe(true);
    if (isErr(r) && r.error.tipo === 'cantidad_invalida') {
      expect(r.error.indice).toBe(1);
    }
  });

  it('acepta el máximo y rechaza uno más', () => {
    expect(isErr(calcularTotal([linea(1, CANTIDAD_MAXIMA_POR_LINEA)]))).toBe(
      false,
    );
    const r = calcularTotal([linea(1, CANTIDAD_MAXIMA_POR_LINEA + 1)]);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.tipo).toBe('cantidad_excede_maximo');
  });
});

describe('mensajes de error', () => {
  it('son legibles', () => {
    expect(describirErrorCalculo({ tipo: 'carrito_vacio' })).toContain('vacío');
    expect(
      describirErrorCalculo({
        tipo: 'cantidad_invalida',
        indice: 0,
        cantidad: 0,
      }),
    ).toContain('línea 1');
  });
});
