/**
 * Tests de los schemas de pedidos (RQ-104, RQ-301).
 *
 * Validan la frontera: lo que el kiosco puede mandar y lo que se rechaza antes
 * de tocar la base.
 */

import { describe, it, expect } from 'vitest';
import { CrearPedido, NombreCliente, ItemPedido } from './order.js';
import { CANTIDAD_MAXIMA_POR_LINEA } from '../order/order-total.js';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function pedidoValido(extra: Record<string, unknown> = {}) {
  return {
    items: [{ productId: 'p1', variantId: null, cantidad: 1, notas: null }],
    nombreCliente: 'Juan',
    tipo: 'COMER_AQUI',
    intentoUuid: UUID,
    ...extra,
  };
}

describe('NombreCliente (D-13)', () => {
  it('acepta un nombre normal', () => {
    expect(NombreCliente.parse('Juan')).toBe('Juan');
  });

  it('recorta los espacios', () => {
    expect(NombreCliente.parse('  Marta  ')).toBe('Marta');
  });

  /** D-13: es obligatorio porque es lo único que desempata montos iguales. */
  it('rechaza el vacío', () => {
    expect(NombreCliente.safeParse('').success).toBe(false);
    expect(NombreCliente.safeParse('   ').success).toBe(false);
  });

  it('rechaza una sola letra', () => {
    expect(NombreCliente.safeParse('J').success).toBe(false);
  });

  it('rechaza un nombre larguísimo', () => {
    expect(NombreCliente.safeParse('a'.repeat(41)).success).toBe(false);
  });

  it('el mensaje de error está en castellano llano', () => {
    const r = NombreCliente.safeParse('');
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.errors[0]?.message).toMatch(/nombre/i);
    }
  });
});

describe('ItemPedido', () => {
  it('acepta un ítem sin variante', () => {
    const r = ItemPedido.safeParse({ productId: 'p1', cantidad: 2 });
    expect(r.success).toBe(true);
  });

  it('rechaza cantidad cero', () => {
    expect(ItemPedido.safeParse({ productId: 'p1', cantidad: 0 }).success).toBe(
      false,
    );
  });

  it('rechaza cantidad fraccionaria', () => {
    expect(ItemPedido.safeParse({ productId: 'p1', cantidad: 1.5 }).success).toBe(
      false,
    );
  });

  it('rechaza una cantidad absurda', () => {
    const r = ItemPedido.safeParse({
      productId: 'p1',
      cantidad: CANTIDAD_MAXIMA_POR_LINEA + 1,
    });
    expect(r.success).toBe(false);
  });

  it('rechaza el ítem sin plato', () => {
    expect(ItemPedido.safeParse({ productId: '', cantidad: 1 }).success).toBe(
      false,
    );
  });
});

describe('CrearPedido', () => {
  it('acepta un pedido completo', () => {
    expect(CrearPedido.safeParse(pedidoValido()).success).toBe(true);
  });

  it('rechaza el carrito vacío', () => {
    expect(CrearPedido.safeParse(pedidoValido({ items: [] })).success).toBe(false);
  });

  it('rechaza un pedido sin nombre (D-13)', () => {
    const { nombreCliente, ...sinNombre } = pedidoValido();
    expect(CrearPedido.safeParse(sinNombre).success).toBe(false);
  });

  it('rechaza un tipo de consumo inventado', () => {
    expect(
      CrearPedido.safeParse(pedidoValido({ tipo: 'DELIVERY' })).success,
    ).toBe(false);
  });

  /** RQ-303: sin UUID no hay idempotencia posible. */
  it('exige un UUID de intento válido', () => {
    expect(
      CrearPedido.safeParse(pedidoValido({ intentoUuid: 'abc' })).success,
    ).toBe(false);
    const { intentoUuid, ...sinUuid } = pedidoValido();
    expect(CrearPedido.safeParse(sinUuid).success).toBe(false);
  });

  /**
   * El total del cliente se acepta en el schema y el servidor lo ignora
   * (`PLAN §6`). El schema no debe rechazarlo: rechazarlo rompería al cliente
   * que lo manda, y validarlo le daría una importancia que no tiene.
   */
  it('acepta el total del cliente sin darle valor', () => {
    const r = CrearPedido.safeParse(pedidoValido({ totalCliente: 1 }));
    expect(r.success).toBe(true);
  });

  it('rechaza demasiados platos distintos', () => {
    const muchos = Array.from({ length: 31 }, (_, i) => ({
      productId: `p${i}`,
      cantidad: 1,
    }));
    expect(CrearPedido.safeParse(pedidoValido({ items: muchos })).success).toBe(
      false,
    );
  });

  it('recorta y limita las notas', () => {
    const r = CrearPedido.safeParse(
      pedidoValido({
        items: [{ productId: 'p1', cantidad: 1, notas: '  sin ají  ' }],
      }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.items[0]?.notas).toBe('sin ají');
    }

    const largo = CrearPedido.safeParse(
      pedidoValido({
        items: [{ productId: 'p1', cantidad: 1, notas: 'x'.repeat(121) }],
      }),
    );
    expect(largo.success).toBe(false);
  });
});
