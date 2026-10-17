/**
 * RQ-104 / RQ-301 — Schemas de pedidos, compartidos cliente y servidor.
 *
 * Fuente: `PLAN §6` ("la validación es la misma en el cliente y el servidor"),
 * `PLAN §7`, `ARQUITECTURA §6`, D-13, `REPORTE CLI-02`.
 *
 * Viven en `shared` porque el kiosco valida antes de enviar y la API valida
 * antes de guardar. Si cada lado tuviera su copia, el día que cambie una regla
 * una de las dos quedaría vieja, y el cliente dejaría pasar algo que la API
 * rechaza con un error que la UI no sabe mostrar.
 */

import { z } from 'zod';
import { CANTIDAD_MAXIMA_POR_LINEA } from '../order/order-total.js';

/**
 * D-13: el nombre del cliente es OBLIGATORIO.
 *
 * Tras derogar el sufijo de centavos (D-04), es la única señal que queda para
 * desempatar dos pedidos del mismo total. `PLAN §7` lo mantiene como el único
 * campo de texto de todo el flujo del kiosco.
 *
 * El límite de 40 caracteres es defensivo (`REPORTE CLI-02` lo marcaba como
 * pendiente): entra un nombre y un apellido, no un párrafo.
 */
export const NombreCliente = z
  .string()
  .trim()
  .min(2, 'Poné tu nombre para que podamos llamarte')
  .max(40, 'El nombre es muy largo');

export const TipoConsumo = z.enum(['COMER_AQUI', 'PARA_LLEVAR']);

export const Cantidad = z
  .number()
  .int('La cantidad tiene que ser un número entero')
  .min(1, 'La cantidad mínima es 1')
  .max(
    CANTIDAD_MAXIMA_POR_LINEA,
    `No se pueden pedir más de ${CANTIDAD_MAXIMA_POR_LINEA} unidades del mismo plato`,
  );

export const ItemPedido = z.object({
  productId: z.string().min(1, 'Falta el plato'),
  /**
   * Opcional: solo los platos con variantes la llevan. Que la variante
   * pertenezca al plato lo verifica el servidor (`REPORTE CLI-02`, RQ-208):
   * sin esa comprobación se podría pedir un plato caro con el precio de la
   * variante barata de otro.
   */
  variantId: z.string().min(1).nullish(),
  cantidad: Cantidad,
  notas: z.string().trim().max(120).nullish(),
});

export const CrearPedido = z.object({
  items: z
    .array(ItemPedido)
    .min(1, 'El carrito está vacío')
    .max(30, 'Demasiados platos distintos en un pedido'),
  nombreCliente: NombreCliente,
  tipo: TipoConsumo,
  /**
   * RQ-303 — UUID del intento, generado por el cliente.
   *
   * Si la respuesta se pierde por WiFi y la tablet reintenta, el servidor
   * reconoce el UUID y devuelve el pedido ya creado en lugar de crear un
   * segundo (`ARQUITECTURA §7`). El motivo, textual de `ARQUITECTURA §9`:
   * "porque el WiFi se va a caer".
   */
  intentoUuid: z.string().uuid('El identificador del intento no es válido'),
  /**
   * El cliente puede mandar su total calculado, pero el servidor lo IGNORA
   * (`PLAN §6`, `ARQUITECTURA §6`). Se acepta en el schema para no romper al
   * cliente que lo envíe, y no se lee nunca. No se compara con el total propio:
   * eso convertiría un dato no confiable en parte de la decisión.
   */
  totalCliente: z.number().int().nonnegative().nullish(),
});

export type CrearPedidoDto = z.infer<typeof CrearPedido>;
export type ItemPedidoDto = z.infer<typeof ItemPedido>;
export type TipoConsumoDto = z.infer<typeof TipoConsumo>;
