/**
 * RQ-305, RQ-312 — Armado de los ítems del pedido con su snapshot.
 *
 * Fuente: `PLAN §4`, `ARQUITECTURA §2`, `ARQUITECTURA §5` (patrón Snapshot),
 * D-04.
 *
 * Función pura: sin Prisma, sin Nest (`ARQUITECTURA §2`).
 *
 * El cálculo del total **no vive acá**: lo hace `calcularTotal` de
 * `packages/shared` (RQ-103 de S1), que ya rechaza carrito vacío, cantidades
 * inválidas y cantidades por encima del máximo, devolviendo `Result` en vez de
 * excepciones. Este módulo solo traduce entre lo que el catálogo devuelve y lo
 * que la base necesita.
 *
 * La regla de `PLAN §6` que sostiene todo esto: **el total se recalcula siempre
 * en el servidor desde los precios de la base; nunca se confía en el total que
 * manda la tablet**. El total del cliente no se compara ni se valida contra el
 * propio: se ignora. Compararlo convertiría un dato no confiable en parte de la
 * decisión (`ARQUITECTURA §6`).
 */

import {
  Money,
  Result,
  calcularTotal,
  type LineaCalculo,
  type ErrorCalculo,
  type ResultType,
} from '@restaurante/shared';

/** Lo que el catálogo aporta de un plato o variante para congelar en el pedido. */
export interface DatosSnapshot {
  readonly nombre: string;
  readonly precioCentavos: number;
}

/** Un ítem pedido, ya resuelto contra el catálogo. */
export interface ItemResuelto {
  readonly productId: string;
  readonly variantId: string | null;
  readonly cantidad: number;
  readonly notas: string | null;
  readonly snapshot: DatosSnapshot;
}

/** Ítem listo para insertar en `OrderItem`, con el precio congelado. */
export interface ItemParaGuardar {
  readonly productId: string;
  readonly variantId: string | null;
  readonly cantidad: number;
  readonly notas: string | null;
  readonly nombreSnapshot: string;
  readonly precioUnitarioSnapshot: number;
}

export interface PedidoArmado {
  /** Centavos enteros, múltiplo de 100 (D-04). */
  readonly subtotal: number;
  /**
   * `total` iguala a `subtotal` (`PLAN §4`). Se conservan los dos campos para
   * que el cierre pueda distinguir la venta del ajuste si alguna vez vuelve a
   * haber uno; el sufijo de centavos quedó derogado (D-04).
   */
  readonly total: number;
  readonly items: readonly ItemParaGuardar[];
}

/**
 * Calcula los totales y congela nombre y precio de cada ítem.
 *
 * Devuelve `Result`: una cantidad inválida es un resultado esperable del
 * dominio, no una excepción (`ARQUITECTURA §5`).
 */
export function armarPedido(
  items: readonly ItemResuelto[],
): ResultType<PedidoArmado, ErrorCalculo> {
  const lineas: LineaCalculo[] = items.map((item) => ({
    // Money.fromCentavos rechaza cualquier monto que no sea múltiplo de 100
    // (D-04), así que un precio corrupto en la base explota acá y no llega al
    // cliente.
    precioUnitario: Money.fromCentavos(item.snapshot.precioCentavos),
    cantidad: item.cantidad,
  }));

  const calculo = calcularTotal(lineas);
  if (Result.isErr(calculo)) {
    return calculo;
  }

  const paraGuardar: ItemParaGuardar[] = items.map((item) => ({
    productId: item.productId,
    variantId: item.variantId,
    cantidad: item.cantidad,
    notas: item.notas,
    nombreSnapshot: item.snapshot.nombre,
    precioUnitarioSnapshot: item.snapshot.precioCentavos,
  }));

  return Result.ok({
    subtotal: Money.toCentavos(calculo.value.subtotal),
    total: Money.toCentavos(calculo.value.total),
    items: paraGuardar,
  });
}
