/**
 * Tests del dominio puro de pedidos (RQ-310, RQ-312).
 *
 * Sin base de datos ni Nest: son funciones puras (`ARQUITECTURA §2`, §8).
 */

import { describe, it, expect } from 'vitest';
import { jornadaDe, mismaJornada, HORA_CORTE_POR_DEFECTO } from './jornada.js';
import { armarPedido, type ItemResuelto } from './armar-pedido.js';
import { Result } from '@restaurante/shared';

// ---------------------------------------------------------------------------
// RQ-310 / D-14 — Jornada con corte a las 05:00
// ---------------------------------------------------------------------------

describe('jornadaDe', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('usa 5 de la mañana como corte por defecto', () => {
    expect(HORA_CORTE_POR_DEFECTO).toBe(5);
  });

  it('un pedido de media tarde cuenta en el día corriente', () => {
    expect(iso(jornadaDe(new Date(2026, 9, 17, 14, 30)))).toBe('2026-10-17');
  });

  it('un pedido a las 23:00 cuenta en el día corriente', () => {
    expect(iso(jornadaDe(new Date(2026, 9, 17, 23, 0)))).toBe('2026-10-17');
  });

  /**
   * El caso que motiva toda la regla: el servicio de noche del viernes que
   * termina a las 2 de la mañana del sábado es UNA jornada, no dos.
   */
  it('las 02:00 pertenecen a la jornada del día anterior', () => {
    expect(iso(jornadaDe(new Date(2026, 9, 18, 2, 0)))).toBe('2026-10-17');
  });

  it('las 04:59 todavía son del día anterior', () => {
    expect(iso(jornadaDe(new Date(2026, 9, 18, 4, 59)))).toBe('2026-10-17');
  });

  it('las 05:00 en punto ya son la jornada nueva', () => {
    expect(iso(jornadaDe(new Date(2026, 9, 18, 5, 0)))).toBe('2026-10-18');
  });

  it('cruza el cambio de mes sin romperse', () => {
    expect(iso(jornadaDe(new Date(2026, 10, 1, 3, 0)))).toBe('2026-10-31');
  });

  it('cruza el cambio de año sin romperse', () => {
    expect(iso(jornadaDe(new Date(2027, 0, 1, 1, 0)))).toBe('2026-12-31');
  });

  it('respeta una hora de corte distinta', () => {
    // Si la dueña cambia el corte a las 03:00, las 02:00 siguen siendo de ayer
    // pero las 04:00 ya son de hoy.
    expect(iso(jornadaDe(new Date(2026, 9, 18, 2, 0), 3))).toBe('2026-10-17');
    expect(iso(jornadaDe(new Date(2026, 9, 18, 4, 0), 3))).toBe('2026-10-18');
  });

  it('rechaza una hora de corte inválida', () => {
    expect(() => jornadaDe(new Date(), 24)).toThrow(/corte inválida/i);
    expect(() => jornadaDe(new Date(), -1)).toThrow(/corte inválida/i);
    expect(() => jornadaDe(new Date(), 5.5)).toThrow(/corte inválida/i);
  });

  it('mismaJornada agrupa el servicio de noche', () => {
    const viernesNoche = new Date(2026, 9, 17, 21, 0);
    const sabadoMadrugada = new Date(2026, 9, 18, 2, 0);
    const sabadoMediodia = new Date(2026, 9, 18, 12, 0);

    expect(mismaJornada(viernesNoche, sabadoMadrugada)).toBe(true);
    expect(mismaJornada(viernesNoche, sabadoMediodia)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RQ-305, RQ-312 — Armado y snapshot
// ---------------------------------------------------------------------------

describe('armarPedido', () => {
  const item = (
    nombre: string,
    precioCentavos: number,
    cantidad: number,
  ): ItemResuelto => ({
    productId: `p-${nombre}`,
    variantId: null,
    cantidad,
    notas: null,
    snapshot: { nombre, precioCentavos },
  });

  it('suma el total de un pedido simple', () => {
    const r = armarPedido([item('Silpancho', 3000, 2)]);
    expect(Result.isOk(r)).toBe(true);
    if (!Result.isOk(r)) return;
    expect(r.value.total).toBe(6000);
    expect(r.value.subtotal).toBe(6000);
  });

  it('suma varias líneas', () => {
    const r = armarPedido([
      item('Pique macho', 4500, 1),
      item('Refresco', 500, 3),
    ]);
    if (!Result.isOk(r)) throw new Error('debía calcular');
    expect(r.value.total).toBe(6000);
  });

  /** RQ-305 — El patrón Snapshot: el nombre y el precio quedan congelados. */
  it('congela nombre y precio en cada ítem', () => {
    const r = armarPedido([item('Silpancho', 3000, 2)]);
    if (!Result.isOk(r)) throw new Error('debía calcular');

    const guardado = r.value.items[0];
    expect(guardado?.nombreSnapshot).toBe('Silpancho');
    expect(guardado?.precioUnitarioSnapshot).toBe(3000);
  });

  it('conserva la variante y las notas', () => {
    const r = armarPedido([
      {
        productId: 'p-refresco',
        variantId: 'v-jarra',
        cantidad: 1,
        notas: 'sin hielo',
        snapshot: { nombre: 'Refresco Jarra', precioCentavos: 1500 },
      },
    ]);
    if (!Result.isOk(r)) throw new Error('debía calcular');

    expect(r.value.items[0]?.variantId).toBe('v-jarra');
    expect(r.value.items[0]?.notas).toBe('sin hielo');
  });

  it('el total es siempre múltiplo de 100 (D-04)', () => {
    const r = armarPedido([item('Pique macho', 4500, 3)]);
    if (!Result.isOk(r)) throw new Error('debía calcular');
    expect(r.value.total % 100).toBe(0);
  });

  it('rechaza el carrito vacío devolviendo Result, no excepción', () => {
    const r = armarPedido([]);
    expect(Result.isErr(r)).toBe(true);
  });

  it('rechaza cantidad cero', () => {
    expect(Result.isErr(armarPedido([item('Silpancho', 3000, 0)]))).toBe(true);
  });

  it('rechaza cantidad negativa', () => {
    expect(Result.isErr(armarPedido([item('Silpancho', 3000, -2)]))).toBe(true);
  });

  it('rechaza cantidad fraccionaria', () => {
    expect(Result.isErr(armarPedido([item('Silpancho', 3000, 1.5)]))).toBe(true);
  });

  /**
   * D-04: un precio que no sea múltiplo de 100 no debería existir en la base
   * (hay CHECK en Postgres). Si apareciera por una carga manual, tiene que
   * explotar acá y no llegarle al cliente.
   */
  it('explota si un precio de la base no es múltiplo de 100', () => {
    expect(() => armarPedido([item('Corrupto', 4542, 1)])).toThrow();
  });
});
