/**
 * Medidas responsive: aritmetica pura, sin react-native.
 *
 * Igual que theme.ts, este modulo lo cargan los tests directamente, asi que no
 * puede importar react-native (su fuente es Flow y rompe el parser de vitest).
 * El puente con useWindowDimensions() vive en shared/ui/index.tsx (useLayout).
 *
 * Por que calcular el ancho de columna en px y no con flexBasis fijo:
 * un flexBasis de 280 con gap de 16 en un celular de 360 px deja la tarjeta
 * mas ancha que el contenido disponible y el grid se desborda o deja huecos
 * raros. Aca se reparte el ancho REAL disponible entre N columnas descontando
 * los gaps, de modo que 1 columna en celular ocupa exactamente el ancho util.
 */

export type Ancho = 'compacto' | 'medio' | 'amplio';

/** Celular vertical hasta 600; tablet/ventana media hasta 1024; escritorio arriba. */
export const LIMITE_COMPACTO = 600;
export const LIMITE_MEDIO = 1024;

/** Ancho maximo del contenido: mas alla de esto el texto se vuelve ilegible. */
export const MAX_CONTENIDO = 1200;

export function anchoDe(ventana: number): Ancho {
  if (!Number.isFinite(ventana) || ventana <= 0) return 'medio';
  if (ventana <= LIMITE_COMPACTO) return 'compacto';
  if (ventana <= LIMITE_MEDIO) return 'medio';
  return 'amplio';
}

export const esCompacto = (ventana: number) => anchoDe(ventana) === 'compacto';

/** Padding exterior de la pagina: mas aire cuanto mas grande la ventana. */
export function paddingDe(ventana: number): number {
  return {compacto: 16, medio: 24, amplio: 32}[anchoDe(ventana)];
}

/** Ancho util para el contenido, ya descontados el tope y los paddings. */
export function anchoContenido(ventana: number, padding = paddingDe(ventana), max = MAX_CONTENIDO): number {
  const util = Math.min(ventana, max) - padding * 2;
  return Math.max(0, Math.round(util));
}

/**
 * Cuantas columnas caben sin que ninguna quede por debajo de `min`.
 * Nunca menos de 1 (si no cabe nada, igual se pinta una columna a ancho total).
 */
export function columnas(disponible: number, min = 280, gap = 16, max = 4): number {
  if (!Number.isFinite(disponible) || disponible <= 0) return 1;
  const tope = Math.max(1, Math.floor(max));
  for (let n = tope; n > 1; n--) {
    const ancho = (disponible - gap * (n - 1)) / n;
    if (ancho >= min) return n;
  }
  return 1;
}

/** Ancho exacto de cada columna repartiendo `disponible` y descontando gaps. */
export function anchoColumna(disponible: number, cols: number, gap = 16): number {
  const n = Math.max(1, Math.floor(cols));
  if (!Number.isFinite(disponible) || disponible <= 0) return 0;
  return Math.max(0, Math.floor((disponible - gap * (n - 1)) / n));
}

export type Rejilla = {
  /** Clasificacion de la ventana, util para decidir densidad o textos cortos. */
  ancho: Ancho;
  cols: number;
  /** Para flexBasis: ancho en px de una celda. */
  basis: number;
  gap: number;
};

/**
 * Rejilla lista para usar en un style: `{flexBasis: basis, flexGrow: 1, maxWidth: basis}`.
 * `restar` descuenta padding extra cuando el grid vive dentro de una tarjeta.
 */
export function rejilla(
  ventana: number,
  {min = 280, max = 4, gap = 16, restar = 0}: {min?: number; max?: number; gap?: number; restar?: number} = {},
): Rejilla {
  const disponible = Math.max(0, anchoContenido(ventana) - restar);
  const cols = columnas(disponible, min, gap, max);
  return {ancho: anchoDe(ventana), cols, basis: anchoColumna(disponible, cols, gap), gap};
}
