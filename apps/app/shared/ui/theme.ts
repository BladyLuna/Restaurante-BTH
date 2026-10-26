/**
 * Temas claro y oscuro.
 *
 * Sin react-native aqui: este modulo lo cargan los tests, y el codigo fuente de
 * RN es Flow, no TS. La lectura del esquema del sistema y la persistencia viven
 * en el proveedor (shared/ui/index.tsx) y en api/config.
 *
 * El modo oscuro NO es "invertir los colores": es una paleta propia. El fondo es
 * un marron-carbon calido, no negro puro, para que acompane al acento terracota
 * y no fatigue la vista en una cocina con poca luz. Los contrastes estan
 * verificados por tests (WCAG AA 4.5:1 en texto, 3:1 en acento).
 */

export type Preferencia = 'claro' | 'oscuro' | 'sistema';
export type Modo = 'claro' | 'oscuro';

export const PREFERENCIA_POR_DEFECTO: Preferencia = 'sistema';

export function normalizarTema(valor: string | null | undefined): Preferencia | null {
  if (valor === 'claro' || valor === 'oscuro' || valor === 'sistema') return valor;
  return null;
}

/** Traduce la preferencia + el esquema del sistema al modo que se pinta. */
export function temaEfectivo(
  preferencia: Preferencia,
  esquemaDelSistema: 'light' | 'dark' | null | undefined,
): Modo {
  if (preferencia === 'claro') return 'claro';
  if (preferencia === 'oscuro') return 'oscuro';
  return esquemaDelSistema === 'dark' ? 'oscuro' : 'claro';
}

export type Paleta = {
  bg: string;
  bgAlt: string;
  white: string;
  surface: string;
  ink: string;
  inkSoft: string;
  muted: string;
  faint: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  onAccent: string;
  danger: string;
  dangerSoft: string;
  onDanger: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  info: string;
  infoSoft: string;
  disabledBg: string;
  disabledInk: string;
  noticeWarnInk: string;
  noticeInfoInk: string;
  noticeErrorInk: string;
  noticeSuccessInk: string;
  cardSelectedBg: string;
  inputFocusedBg: string;
  shadowColor: string;
  skeleton: string;
};

/** Crema y terracota. El near-black es calido (#222222), nunca negro puro. */
const CLARO: Paleta = {
  bg: '#F6F2EA',
  bgAlt: '#EFE9DD',
  white: '#FFFFFF',
  surface: '#FFFFFF',
  ink: '#222222',
  inkSoft: '#3C3A36',
  muted: '#5F584F',
  faint: '#8A8279',
  line: '#E3DCD0',
  lineStrong: '#CFC6B7',
  accent: '#A33F24',
  accentDeep: '#8A3219',
  accentSoft: '#F6E6DF',
  onAccent: '#FFFFFF',
  danger: '#7E1D0F',
  dangerSoft: '#F7E2DC',
  onDanger: '#FFFFFF',
  success: '#2E6B4F',
  successSoft: '#E3EFE8',
  warn: '#8A5A12',
  warnSoft: '#FBEFD6',
  info: '#2F5068',
  infoSoft: '#E6EDF3',
  disabledBg: '#E6E0D5',
  disabledInk: '#8A8279',
  noticeWarnInk: '#5B3B0B',
  noticeInfoInk: '#223C4D',
  noticeErrorInk: '#5E1509',
  noticeSuccessInk: '#1E4A37',
  cardSelectedBg: '#FFFDFB',
  inputFocusedBg: '#FFFDFB',
  shadowColor: '#2A1C10',
  skeleton: '#E8E1D5',
};

/** Carbon calido con matiz marron. El acento se aclara para sobrevivir al fondo. */
const OSCURO: Paleta = {
  bg: '#17140F',
  bgAlt: '#201C16',
  white: '#FFFFFF',
  surface: '#221E18',
  ink: '#F2EDE4',
  inkSoft: '#DCD5C9',
  muted: '#AFA69A',
  faint: '#8A8279',
  line: '#332D25',
  lineStrong: '#473F34',
  accent: '#E8835F',
  accentDeep: '#F0A184',
  accentSoft: '#3A241B',
  onAccent: '#1A120D',
  danger: '#F09A82',
  dangerSoft: '#3D1C14',
  onDanger: '#1A0D08',
  success: '#7FC9A3',
  successSoft: '#17301F',
  warn: '#E8B872',
  warnSoft: '#33260F',
  info: '#8FBBD9',
  infoSoft: '#15242E',
  disabledBg: '#2A251E',
  disabledInk: '#7A736A',
  noticeWarnInk: '#F2D9A8',
  noticeInfoInk: '#C5DCEC',
  noticeErrorInk: '#F6C6B6',
  noticeSuccessInk: '#B8E2CC',
  cardSelectedBg: '#2A211A',
  inputFocusedBg: '#2A241C',
  shadowColor: '#000000',
  skeleton: '#2A251E',
};

export function paletaDe(modo: Modo): Paleta {
  return modo === 'oscuro' ? OSCURO : CLARO;
}

export const CLAVE_TEMA = 'restaurante.tema';
