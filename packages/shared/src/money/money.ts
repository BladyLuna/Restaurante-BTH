/**
 * RQ-101 — Value object Money
 *
 * Fuente: PLAN §4 "Dinero", ARQUITECTURA §5 (tabla de patrones), D-04.
 *
 * Reglas que esto hace cumplir:
 *   - Entero en centavos, nunca Float. Un Float acumula error de redondeo y
 *     los totales dejan de cuadrar con el banco (PLAN §4).
 *   - Tipo propio: sumar un Money a un number no compila.
 *   - Todos los montos son MÚLTIPLOS DE 100 (bolivianos enteros, D-04).
 *     El sufijo de centavos fue derogado: cobrar Bs 45,42 cuando el plato dice
 *     Bs 45 se percibe como abuso.
 *   - El formateo a "Bs 45" ocurre solo acá; la UI nunca arma el string.
 */

/** Marca nominal: impide que un number se use donde se espera Money. */
declare const MONEY_BRAND: unique symbol;

export type Money = {
  readonly centavos: number;
  readonly [MONEY_BRAND]: true;
};

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const CENTAVOS_POR_BOLIVIANO = 100;

function crear(centavos: number): Money {
  return { centavos } as Money;
}

/**
 * Construye un Money desde centavos. Rechaza todo lo que no sea un entero
 * múltiplo de 100 (D-04).
 */
export function fromCentavos(centavos: number): Money {
  if (!Number.isFinite(centavos)) {
    throw new MoneyError(`Monto no finito: ${centavos}`);
  }
  if (!Number.isInteger(centavos)) {
    throw new MoneyError(
      `Los montos se expresan en centavos enteros, se recibió ${centavos}`,
    );
  }
  if (centavos < 0) {
    throw new MoneyError(`Monto negativo: ${centavos}`);
  }
  if (centavos % CENTAVOS_POR_BOLIVIANO !== 0) {
    throw new MoneyError(
      `Los montos son bolivianos enteros (múltiplos de 100 centavos). ` +
        `Se recibió ${centavos}, que equivale a Bs ${centavos / 100}. ` +
        `El sufijo de centavos fue derogado (D-04).`,
    );
  }
  return crear(centavos);
}

/** Construye un Money desde bolivianos enteros. Bs 45 → 4500 centavos. */
export function fromBolivianos(bolivianos: number): Money {
  if (!Number.isInteger(bolivianos)) {
    throw new MoneyError(
      `Los precios son bolivianos enteros, se recibió ${bolivianos}`,
    );
  }
  return fromCentavos(bolivianos * CENTAVOS_POR_BOLIVIANO);
}

export const ZERO: Money = crear(0);

export function add(a: Money, b: Money): Money {
  return fromCentavos(a.centavos + b.centavos);
}

export function subtract(a: Money, b: Money): Money {
  const resultado = a.centavos - b.centavos;
  if (resultado < 0) {
    throw new MoneyError(
      `Resta negativa: ${a.centavos} - ${b.centavos}. ` +
        `Si representa una diferencia de pago, usá difference().`,
    );
  }
  return fromCentavos(resultado);
}

/**
 * Multiplica por una cantidad entera de unidades (cantidad de un ítem del
 * pedido). No acepta fracciones: no hay medio plato.
 */
export function multiply(monto: Money, cantidad: number): Money {
  if (!Number.isInteger(cantidad)) {
    throw new MoneyError(`La cantidad debe ser un entero, se recibió ${cantidad}`);
  }
  if (cantidad < 0) {
    throw new MoneyError(`Cantidad negativa: ${cantidad}`);
  }
  return fromCentavos(monto.centavos * cantidad);
}

export function sum(montos: readonly Money[]): Money {
  return montos.reduce<Money>((acc, m) => add(acc, m), ZERO);
}

/**
 * Diferencia absoluta entre dos montos, con signo informado aparte.
 * Se usa en el camino de "confirmar con diferencia" (PLAN §5b), que está
 * reservado a ADMIN: CAJA no resuelve diferencias (D-02).
 */
export function difference(
  esperado: Money,
  recibido: Money,
): { monto: Money; signo: 'exacto' | 'faltante' | 'excedente' } {
  const delta = recibido.centavos - esperado.centavos;
  if (delta === 0) return { monto: ZERO, signo: 'exacto' };
  return {
    monto: fromCentavos(Math.abs(delta)),
    signo: delta < 0 ? 'faltante' : 'excedente',
  };
}

export function equals(a: Money, b: Money): boolean {
  return a.centavos === b.centavos;
}

export function isZero(monto: Money): boolean {
  return monto.centavos === 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  if (a.centavos < b.centavos) return -1;
  if (a.centavos > b.centavos) return 1;
  return 0;
}

export function toBolivianos(monto: Money): number {
  return monto.centavos / CENTAVOS_POR_BOLIVIANO;
}

/**
 * Formateo único del sistema. Nunca muestra centavos, porque por D-04 no
 * existen montos con centavos.
 */
export function format(monto: Money): string {
  return `Bs ${toBolivianos(monto)}`;
}

/** Igual que format pero sin el prefijo, para cuando la UI ya lo pone. */
export function formatNumber(monto: Money): string {
  return String(toBolivianos(monto));
}

/**
 * Parsea lo que una persona tipeó en el panel de confirmación (PLAN §5b).
 * Acepta "45", "Bs 45", "bs45", " 45 ". Rechaza decimales: si alguien tipea
 * 45,42 es que está mirando un monto que este sistema no genera.
 */
export function parse(entrada: string): Money {
  const limpio = entrada
    .trim()
    .replace(/^bs\.?\s*/i, '')
    .replace(/\s/g, '');

  if (limpio === '') {
    throw new MoneyError('Monto vacío');
  }
  if (!/^\d+$/.test(limpio)) {
    throw new MoneyError(
      `"${entrada}" no es un monto válido. Los montos son bolivianos enteros, ` +
        `sin centavos (D-04).`,
    );
  }
  return fromBolivianos(Number(limpio));
}

/** Para persistir y para los DTO. El valor que va a la base. */
export function toCentavos(monto: Money): number {
  return monto.centavos;
}

/**
 * Valida un precio que viene del panel de catálogo antes de guardarlo.
 * Fuente: PLAN §6 "se rechazan precios que no sean múltiplos de 100 centavos".
 */
export function esPrecioValido(centavos: number): boolean {
  return (
    Number.isInteger(centavos) &&
    centavos > 0 &&
    centavos % CENTAVOS_POR_BOLIVIANO === 0
  );
}
