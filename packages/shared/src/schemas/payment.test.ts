import { expect, it } from 'vitest';
import { PaymentSchemas as S } from '../index.js';

it('exporta contratos de confirmación y búsqueda en centavos enteros', () => {
  expect(S.ConfirmarPago.parse({ orderId: 'pedido', montoRecibido: 4500 })).toEqual({ orderId: 'pedido', montoRecibido: 4500 });
  expect(S.BuscarPorMonto.parse({ total: '4500' })).toEqual({ total: 4500 });
  expect(S.ConfirmarPorMonto.parse({ montoRecibido: 4500 })).toEqual({ montoRecibido: 4500 });
});

it.each([0, -100, 4501, 4500.5, 2147483700, NaN, Infinity, '4500'])('rechaza monto inválido %s', montoRecibido => {
  expect(S.ConfirmarPorMonto.safeParse({ montoRecibido }).success).toBe(false);
});

it.each(['userId', 'confirmadoPorId', 'locationId', 'paymentProofId'])('no acepta %s como autorización', campo => {
  expect(S.ConfirmarPago.safeParse({ orderId: 'pedido', montoRecibido: 4500, [campo]: 'inyectado' }).success).toBe(false);
});