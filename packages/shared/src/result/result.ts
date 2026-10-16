/**
 * RQ-103 — Result en vez de excepciones para errores de dominio
 *
 * Fuente: ARQUITECTURA §5 (tabla de patrones).
 *
 * "Transición inválida" o "plato inactivo" son resultados esperables, no
 * excepciones. Las excepciones quedan para fallas reales: base caída, disco
 * lleno, bug.
 *
 * Por qué importa acá: si un plato agotado lanza una excepción, el manejo
 * termina en un catch genérico que devuelve 500 y el kiosco muestra "error del
 * servidor" a un cliente que solo quería otro plato.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return !r.ok;
}

export function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? ok(fn(r.value)) : r;
}

export function flatMap<T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => Result<U, E>,
): Result<U, E> {
  return r.ok ? fn(r.value) : r;
}

export function mapErr<T, E, F>(
  r: Result<T, E>,
  fn: (e: E) => F,
): Result<T, F> {
  return r.ok ? r : err(fn(r.error));
}

export function unwrapOr<T, E>(r: Result<T, E>, fallback: T): T {
  return r.ok ? r.value : fallback;
}

/**
 * Extrae el valor o lanza. Solo para tests y para bordes donde un Err ya es
 * un bug del programa, no un caso de negocio.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap sobre un Err: ${JSON.stringify(r.error)}`);
}

/**
 * Colecta una lista de Results. Devuelve el primer Err, o la lista de valores.
 * Se usa al validar los ítems de un carrito: si uno falla, el pedido no se crea.
 */
export function all<T, E>(results: readonly Result<T, E>[]): Result<T[], E> {
  const valores: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    valores.push(r.value);
  }
  return ok(valores);
}
