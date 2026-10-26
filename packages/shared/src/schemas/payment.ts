/**
 * RQ-104 / B8 — Schemas de pagos, compartidos cliente y servidor.
 *
 * Fuente: `PLAN §5b`, `PLAN §6`, `ARQUITECTURA §6`, D-04, D-05, D-11.
 *
 * El panel de cobro (F4, S7) valida con estos mismos schemas antes de enviar.
 */

import { z } from 'zod';

/**
 * Monto en CENTAVOS, múltiplo de 100 (D-04).
 *
 * El panel manda centavos y no bolivianos a propósito: toda la API habla en
 * centavos, y convertir en la frontera deja un solo lugar donde equivocarse.
 */
export const MontoCentavos = z
  .number()
  .int('El monto tiene que ser un número entero')
  .positive('El monto tiene que ser mayor a cero')
  .max(2147483647, 'El monto excede el máximo permitido')
  .refine(
    (v) => v % 100 === 0,
    'El monto tiene que ser en bolivianos enteros, sin centavos',
  );

/**
 * RQ-405 — Confirmación normal.
 *
 * Lleva el `orderId` explícito: quien confirma eligió un pedido concreto de la
 * lista. No hay "confirmar el que coincida", porque con dos pedidos del mismo
 * total eso acreditaría el pago al cliente equivocado (RQ-407, R-01).
 *
 * El monto va igual, aunque el servidor ya lo sepa: es la respuesta a la
 * pregunta "¿recibiste Bs X de este pedido?" (`PLAN §5b`). Si no coincide
 * exactamente con el total, el servidor rechaza y manda al flujo de ADMIN
 * (D-11). Que el operador tipee el monto obliga a mirarlo.
 */
export const ConfirmarPago = z.object({
  orderId: z.string().min(1, 'Falta el pedido'),
  montoRecibido: MontoCentavos,
}).strict();

export const ConfirmarPorMonto = z.object({ montoRecibido: MontoCentavos }).strict();
export const BuscarPorMonto = z.object({ total: z.coerce.number().pipe(MontoCentavos) }).strict();

/**
 * RQ-408 / D-11 — Confirmación con diferencia. Solo ADMIN.
 *
 * `motivo` es obligatorio: una diferencia sin explicación en el log no sirve
 * para explicar un cierre que no cuadra (`PLAN §7`).
 */
export const ConfirmarConDiferencia = z.object({
  orderId: z.string().min(1, 'Falta el pedido'),
  montoRecibido: MontoCentavos,
  motivo: z
    .string()
    .trim()
    .min(5, 'Explicá la diferencia: queda en el registro')
    .max(200),
}).strict();

/** RQ-409 / D-09 — Cancelar un pedido pagado genera una obligación. */
export const CancelarPagado = z.object({
  motivo: z
    .string()
    .trim()
    .min(5, 'Explicá por qué se cancela un pedido ya cobrado')
    .max(200),
});

/** RQ-409 — Cerrar un refund: la plata ya se devolvió. */
export const CerrarRefund = z.object({
  formaDevolucion: z
    .string()
    .trim()
    .min(3, 'Indicá cómo se devolvió: efectivo, transferencia')
    .max(60),
});

/** RQ-401 — Alta de un QR. */
export const CrearQr = z.object({
  etiqueta: z
    .string()
    .trim()
    .min(2, 'Ponele un nombre para reconocerlo')
    .max(60),
  imagenUrl: z.string().min(1, 'Falta la imagen del QR'),
  /** Si se activa al crearlo, desactiva el anterior en la misma transacción. */
  activar: z.boolean().default(false),
});

/**
 * RQ-402 / D-08 — Edición de un QR.
 *
 * `imagenUrl` NO está acá a propósito: la imagen de un QR con pedidos es
 * inmutable. Reemplazarla crea una fila nueva y archiva la anterior, porque si
 * se editara en el lugar los pedidos viejos apuntarían a una imagen que no es
 * la que se les mostró, y el cuadre por cuenta dejaría de ser auditable.
 */
export const EditarQr = z.object({
  etiqueta: z.string().trim().min(2).max(60),
});

/** RQ-410 / D-05 — Comprobante. Es evidencia, NO autoriza confirmar. */
export const AdjuntarComprobante = z.object({
  imagenUrl: z.string().min(1, 'Falta la imagen'),
  motivo: z
    .string()
    .trim()
    .min(5, 'Explicá por qué lo adjuntás')
    .max(200),
});

export type ConfirmarPagoDto = z.infer<typeof ConfirmarPago>;
export type ConfirmarConDiferenciaDto = z.infer<typeof ConfirmarConDiferencia>;
export type CancelarPagadoDto = z.infer<typeof CancelarPagado>;
export type CerrarRefundDto = z.infer<typeof CerrarRefund>;
export type CrearQrDto = z.infer<typeof CrearQr>;
export type EditarQrDto = z.infer<typeof EditarQr>;
export type AdjuntarComprobanteDto = z.infer<typeof AdjuntarComprobante>;
