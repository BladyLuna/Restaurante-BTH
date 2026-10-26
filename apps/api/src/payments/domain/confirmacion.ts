/** Regla pura D-12: el timeout incluye el instante exacto de vencimiento. */
export function limiteDePago(ahora: Date, minutos: unknown): Date {
  if (typeof minutos !== 'number' || !Number.isSafeInteger(minutos) || minutos <= 0) {
    throw new Error('pedido.timeout_minutos debe ser un entero positivo');
  }
  return new Date(ahora.getTime() - minutos * 60_000);
}