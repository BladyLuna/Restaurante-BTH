/**
 * Tests de Money — RQ-101.
 *
 * Fuente del plan de pruebas: ARQUITECTURA §8 ("Money: redondeo, formateo,
 * suma") y S1 RQ-101.
 *
 * Lo que más importa acá: que un monto con centavos sea imposible de
 * construir. Es la garantía de D-04.
 */

import { describe, it, expect } from 'vitest';
import {
  fromCentavos,
  fromBolivianos,
  ZERO,
  add,
  subtract,
  multiply,
  sum,
  difference,
  equals,
  isZero,
  compare,
  toBolivianos,
  format,
  formatNumber,
  parse,
  toCentavos,
  esPrecioValido,
  MoneyError,
} from './money.js';

describe('construcción', () => {
  it('acepta múltiplos de 100 centavos', () => {
    expect(toCentavos(fromCentavos(4500))).toBe(4500);
    expect(toCentavos(fromCentavos(0))).toBe(0);
  });

  it('rechaza montos con centavos — garantía de D-04', () => {
    expect(() => fromCentavos(4542)).toThrow(MoneyError);
    expect(() => fromCentavos(1)).toThrow(MoneyError);
    expect(() => fromCentavos(99)).toThrow(MoneyError);
    expect(() => fromCentavos(4501)).toThrow(MoneyError);
  });

  it('el mensaje de error explica por qué, no solo que falló', () => {
    expect(() => fromCentavos(4542)).toThrow(/bolivianos enteros/);
    expect(() => fromCentavos(4542)).toThrow(/D-04/);
  });

  it('rechaza no enteros', () => {
    expect(() => fromCentavos(4500.5)).toThrow(MoneyError);
  });

  it('rechaza negativos', () => {
    expect(() => fromCentavos(-100)).toThrow(MoneyError);
  });

  it('rechaza NaN e Infinity', () => {
    expect(() => fromCentavos(NaN)).toThrow(MoneyError);
    expect(() => fromCentavos(Infinity)).toThrow(MoneyError);
  });

  it('fromBolivianos convierte a centavos', () => {
    expect(toCentavos(fromBolivianos(45))).toBe(4500);
    expect(toCentavos(fromBolivianos(0))).toBe(0);
  });

  it('fromBolivianos rechaza decimales', () => {
    expect(() => fromBolivianos(45.42)).toThrow(MoneyError);
    expect(() => fromBolivianos(45.5)).toThrow(MoneyError);
  });
});

describe('aritmética sin pérdida de precisión', () => {
  it('suma', () => {
    expect(toCentavos(add(fromBolivianos(45), fromBolivianos(38)))).toBe(8300);
  });

  it('resta', () => {
    expect(toCentavos(subtract(fromBolivianos(45), fromBolivianos(38)))).toBe(700);
  });

  it('la resta negativa falla en vez de devolver basura', () => {
    expect(() => subtract(fromBolivianos(38), fromBolivianos(45))).toThrow(
      MoneyError,
    );
  });

  it('multiplica por cantidad de unidades', () => {
    expect(toCentavos(multiply(fromBolivianos(15), 3))).toBe(4500);
    expect(toCentavos(multiply(fromBolivianos(15), 0))).toBe(0);
  });

  it('rechaza cantidades fraccionarias — no hay medio plato', () => {
    expect(() => multiply(fromBolivianos(15), 1.5)).toThrow(MoneyError);
  });

  it('rechaza cantidades negativas', () => {
    expect(() => multiply(fromBolivianos(15), -1)).toThrow(MoneyError);
  });

  it('suma una lista', () => {
    const items = [fromBolivianos(15), fromBolivianos(20), fromBolivianos(10)];
    expect(toCentavos(sum(items))).toBe(4500);
  });

  it('suma de lista vacía es cero', () => {
    expect(isZero(sum([]))).toBe(true);
  });

  it('cien sumas de Bs 1 dan exactamente Bs 100 — sin error de float', () => {
    let acc = ZERO;
    for (let i = 0; i < 100; i++) acc = add(acc, fromBolivianos(1));
    expect(toCentavos(acc)).toBe(10000);
    expect(toBolivianos(acc)).toBe(100);
  });
});

describe('diferencia de pago — camino de ADMIN (PLAN §5b)', () => {
  it('monto exacto', () => {
    const d = difference(fromBolivianos(45), fromBolivianos(45));
    expect(d.signo).toBe('exacto');
    expect(isZero(d.monto)).toBe(true);
  });

  it('el cliente pagó menos', () => {
    const d = difference(fromBolivianos(45), fromBolivianos(43));
    expect(d.signo).toBe('faltante');
    expect(toBolivianos(d.monto)).toBe(2);
  });

  it('el cliente pagó más', () => {
    const d = difference(fromBolivianos(45), fromBolivianos(50));
    expect(d.signo).toBe('excedente');
    expect(toBolivianos(d.monto)).toBe(5);
  });
});

describe('comparación', () => {
  it('equals', () => {
    expect(equals(fromBolivianos(45), fromBolivianos(45))).toBe(true);
    expect(equals(fromBolivianos(45), fromBolivianos(46))).toBe(false);
  });

  it('compare ordena', () => {
    expect(compare(fromBolivianos(10), fromBolivianos(20))).toBe(-1);
    expect(compare(fromBolivianos(20), fromBolivianos(10))).toBe(1);
    expect(compare(fromBolivianos(10), fromBolivianos(10))).toBe(0);
  });
});

describe('formateo — nunca muestra centavos', () => {
  it('format', () => {
    expect(format(fromBolivianos(45))).toBe('Bs 45');
    expect(format(fromBolivianos(0))).toBe('Bs 0');
    expect(format(fromBolivianos(1234))).toBe('Bs 1234');
  });

  it('formatNumber sin prefijo', () => {
    expect(formatNumber(fromBolivianos(45))).toBe('45');
  });
});

describe('parse — lo que se tipea en el panel de confirmación', () => {
  it('acepta un número pelado', () => {
    expect(toBolivianos(parse('45'))).toBe(45);
  });

  it('acepta con prefijo y espacios', () => {
    expect(toBolivianos(parse('Bs 45'))).toBe(45);
    expect(toBolivianos(parse('bs45'))).toBe(45);
    expect(toBolivianos(parse('  45  '))).toBe(45);
    expect(toBolivianos(parse('Bs. 45'))).toBe(45);
  });

  it('rechaza decimales: este sistema no genera esos montos', () => {
    expect(() => parse('45.42')).toThrow(MoneyError);
    expect(() => parse('45,42')).toThrow(MoneyError);
  });

  it('rechaza vacío y basura', () => {
    expect(() => parse('')).toThrow(MoneyError);
    expect(() => parse('   ')).toThrow(MoneyError);
    expect(() => parse('abc')).toThrow(MoneyError);
  });
});

describe('esPrecioValido — validación del catálogo (PLAN §6)', () => {
  it('acepta precios enteros positivos', () => {
    expect(esPrecioValido(4500)).toBe(true);
    expect(esPrecioValido(100)).toBe(true);
  });

  it('rechaza cero, negativos y montos con centavos', () => {
    expect(esPrecioValido(0)).toBe(false);
    expect(esPrecioValido(-100)).toBe(false);
    expect(esPrecioValido(4542)).toBe(false);
    expect(esPrecioValido(4500.5)).toBe(false);
  });
});
