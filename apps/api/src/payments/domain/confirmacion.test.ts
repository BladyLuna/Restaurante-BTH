import { expect, it } from 'vitest';
import { limiteDePago } from './confirmacion.js';

it('calcula el límite de vencimiento sin depender del reloj global', () => {
  expect(limiteDePago(new Date('2026-10-17T12:00:00Z'), 15)).toEqual(new Date('2026-10-17T11:45:00Z'));
});

it.each([0, -1, 1.5, '15', null, NaN, Infinity])('falla cerrado ante timeout inválido %s', minutos => {
  expect(() => limiteDePago(new Date(), minutos)).toThrow('pedido.timeout_minutos');
});