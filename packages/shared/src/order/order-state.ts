/**
 * RQ-102 — Tabla de transiciones de estado del pedido
 *
 * Fuente: ARQUITECTURA §4 (SRP: la máquina de estados en un solo lugar),
 *         PLAN §5 (flujo del pedido), REPORTE §9.
 *
 * Por qué vive en shared: el frontend también necesita saber qué botones
 * mostrar (ARQUITECTURA §4). Un solo origen de verdad para la regla.
 *
 * La tentación que esto evita: poner `if (order.estado === 'PAGADO')` en el
 * controller de cocina, otro en el de admin, otro en el kiosco. Después se
 * agrega un estado y hay que encontrar los siete lugares.
 */

export const ESTADOS = [
  'PENDIENTE_PAGO',
  'PAGADO',
  'EN_PREPARACION',
  'LISTO',
  'ENTREGADO',
  'CANCELADO',
] as const;

export type EstadoPedido = (typeof ESTADOS)[number];

/**
 * Tabla de transiciones. ENTREGADO y CANCELADO son terminales: no hay
 * devolución, reapertura, preparación parcial ni cancelación desde
 * EN_PREPARACION o LISTO (REPORTE §9).
 *
 * Si el negocio necesita esos casos, se diseñan — no se fuerzan con cambios
 * manuales en la base.
 */
export const TRANSICIONES: Readonly<
  Record<EstadoPedido, readonly EstadoPedido[]>
> = {
  PENDIENTE_PAGO: ['PAGADO', 'CANCELADO'],
  PAGADO: ['EN_PREPARACION', 'CANCELADO'],
  EN_PREPARACION: ['LISTO'],
  LISTO: ['ENTREGADO'],
  ENTREGADO: [],
  CANCELADO: [],
} as const;

/** Roles que pueden operar el sistema. Fuente: PLAN §5g. */
export const ROLES = ['ADMIN', 'CAJA', 'COCINA'] as const;
export type Rol = (typeof ROLES)[number];

/** Actor de una transición. KIOSCO no es un usuario: es un dispositivo. */
export type Actor = Rol | 'KIOSCO' | 'SISTEMA';

/**
 * Quién puede ejecutar cada transición. Fuente: PLAN §5g (matriz de permisos).
 *
 * Notas que vienen de decisiones cerradas:
 *   - CAJA confirma pagos de monto coincidente (D-02). La confirmación con
 *     diferencia NO es una transición distinta: es el mismo PENDIENTE_PAGO →
 *     PAGADO, pero restringido a ADMIN por regla de servicio, no por la tabla.
 *   - CAJA no cancela pedidos pagados (D-02).
 *   - El vencimiento por timeout lo ejecuta el SISTEMA (PLAN §5b, carritos
 *     abandonados).
 */
export const ACTORES_PERMITIDOS: Readonly<
  Record<string, readonly Actor[]>
> = {
  'PENDIENTE_PAGO->PAGADO': ['CAJA', 'ADMIN'],
  'PENDIENTE_PAGO->CANCELADO': ['ADMIN', 'SISTEMA'],
  'PAGADO->EN_PREPARACION': ['COCINA'],
  'PAGADO->CANCELADO': ['ADMIN'],
  'EN_PREPARACION->LISTO': ['COCINA'],
  'LISTO->ENTREGADO': ['COCINA', 'CAJA', 'ADMIN'],
} as const;

function clave(desde: EstadoPedido, hacia: EstadoPedido): string {
  return `${desde}->${hacia}`;
}

/** ¿La transición existe en la tabla? Función pura, sin base de datos. */
export function puedeTransicionar(
  desde: EstadoPedido,
  hacia: EstadoPedido,
): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** ¿Este actor puede ejecutar esta transición? Fuente: PLAN §5g. */
export function actorPuedeTransicionar(
  desde: EstadoPedido,
  hacia: EstadoPedido,
  actor: Actor,
): boolean {
  if (!puedeTransicionar(desde, hacia)) return false;
  const permitidos = ACTORES_PERMITIDOS[clave(desde, hacia)];
  return permitidos !== undefined && permitidos.includes(actor);
}

export function esTerminal(estado: EstadoPedido): boolean {
  return TRANSICIONES[estado].length === 0;
}

export function transicionesDesde(
  estado: EstadoPedido,
): readonly EstadoPedido[] {
  return TRANSICIONES[estado];
}

/**
 * Estados que cocina puede ver como trabajo en el tablero.
 * Fuente: PLAN §6 (GET /kitchen/orders), REPORTE COC-01.
 *
 * PENDIENTE_PAGO NO está acá, y es el punto de todo el diseño: un pedido sin
 * pago confirmado nunca llega a cocina como trabajo preparable. Puede mostrarse
 * un contador informativo de pendientes, nada más (PLAN §5b).
 */
export const ESTADOS_COCINA: readonly EstadoPedido[] = [
  'PAGADO',
  'EN_PREPARACION',
  'LISTO',
] as const;

export function esTrabajoDeCocina(estado: EstadoPedido): boolean {
  return ESTADOS_COCINA.includes(estado);
}

/** Un pedido en este estado está esperando que alguien verifique el abono. */
export function esperaConfirmacionDePago(estado: EstadoPedido): boolean {
  return estado === 'PENDIENTE_PAGO';
}

/**
 * ¿El dinero de este pedido ya entró? Se usa para el cuadre de cierre
 * (PLAN §5e regla 6) y para decidir si una cancelación genera un Refund
 * (D-09: cancelar no reembolsa, crea una obligación pendiente).
 */
export function tuvoPagoConfirmado(estado: EstadoPedido): boolean {
  return (
    estado === 'PAGADO' ||
    estado === 'EN_PREPARACION' ||
    estado === 'LISTO' ||
    estado === 'ENTREGADO'
  );
}

export type ErrorTransicion =
  | { tipo: 'transicion_invalida'; desde: EstadoPedido; hacia: EstadoPedido }
  | {
      tipo: 'actor_no_autorizado';
      desde: EstadoPedido;
      hacia: EstadoPedido;
      actor: Actor;
    };

export function describirError(error: ErrorTransicion): string {
  switch (error.tipo) {
    case 'transicion_invalida':
      return `No se puede pasar de ${error.desde} a ${error.hacia}`;
    case 'actor_no_autorizado':
      return `${error.actor} no está autorizado a pasar un pedido de ${error.desde} a ${error.hacia}`;
  }
}
