/**
 * RQ-112 — Hash de PIN con argon2id
 *
 * Fuente: PLAN §6, D-06, S1 RQ-112.
 *
 * Por qué argon2id y no bcrypt: argon2id es memory-hard. Un PIN de 6 dígitos
 * son un millón de combinaciones, barato de recorrer en GPU si el hash es
 * rápido. Pedir 64 MB por intento vuelve inviable el ataque en paralelo.
 *
 * Esto NO reemplaza al límite de intentos. El hash encarece el ataque offline
 * (alguien que robó la base); el rate limit frena el ataque online (alguien
 * tipeando en la tablet). Hacen falta los dos.
 */

import * as argon2 from 'argon2';

/**
 * Parámetros deliberados. Si se cambian, los hashes viejos siguen validando
 * porque argon2 guarda los parámetros dentro del propio hash.
 */
const OPCIONES: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 1,
};

/** Largo mínimo de PIN según rol. Fuente: D-06. */
export const LARGO_PIN = {
  /** Confirma cobros: 6 dígitos. Un millón de combinaciones. */
  FINANCIERO: 6,
  /** No autoriza dinero: 4 dígitos admisibles. */
  OPERATIVO: 4,
} as const;

export class PinInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PinInvalidoError';
  }
}

/**
 * Valida la forma de un PIN antes de hashearlo.
 * Solo dígitos: un PIN con letras obligaría a un teclado completo en una
 * tablet que se usa con las manos ocupadas (PLAN §7).
 */
export function validarFormaPin(pin: string, largoMinimo: number): void {
  if (!/^\d+$/.test(pin)) {
    throw new PinInvalidoError('El PIN debe ser solo dígitos');
  }
  if (pin.length < largoMinimo) {
    throw new PinInvalidoError(
      `El PIN debe tener al menos ${largoMinimo} dígitos`,
    );
  }
  if (pin.length > 12) {
    throw new PinInvalidoError('El PIN no puede tener más de 12 dígitos');
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new PinInvalidoError(
      'El PIN no puede ser todos los dígitos iguales (1111, 0000)',
    );
  }
  if (esSecuencia(pin)) {
    throw new PinInvalidoError(
      'El PIN no puede ser una secuencia (1234, 4321, 123456)',
    );
  }
}

/** 1234, 4321, 123456, 987654. Son los primeros que prueba cualquiera. */
function esSecuencia(pin: string): boolean {
  let ascendente = true;
  let descendente = true;
  for (let i = 1; i < pin.length; i++) {
    const anterior = pin.charCodeAt(i - 1);
    const actual = pin.charCodeAt(i);
    if (actual !== anterior + 1) ascendente = false;
    if (actual !== anterior - 1) descendente = false;
  }
  return ascendente || descendente;
}

export async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, OPCIONES);
}

/**
 * Verifica un PIN. Devuelve false ante cualquier problema en vez de lanzar:
 * un hash corrupto en la base no debe tumbar el login, debe rechazarlo.
 */
export async function verificarPin(
  pin: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}

/** Largo mínimo que corresponde a un rol. Fuente: D-06. */
export function largoMinimoParaRol(rol: 'ADMIN' | 'CAJA' | 'COCINA'): number {
  return rol === 'COCINA' ? LARGO_PIN.OPERATIVO : LARGO_PIN.FINANCIERO;
}
