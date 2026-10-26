// Configuración de la dirección de la API. Sin imports de react-native en el nivel
// superior: este módulo lo cargan los tests, y el código fuente de RN es Flow, no TS.

const CLAVE = 'restaurante.apiUrl';

let fallback = 'http://localhost:3000';

/** La capa de UI inyecta la dirección deducida del entorno (web/Expo Go) al arrancar. */
export function setApiUrlPorDefecto(valor: string): void {
  fallback = valor;
}

export function apiUrlPorDefecto(): string {
  return fallback;
}

/** Acepta `192.168.0.100`, `192.168.0.100:3001` o una URL completa. Devuelve null si no sirve. */
export function normalizarApiUrl(entrada: string): string | null {
  const texto = entrada.trim();
  if (!texto) return null;
  if (/\s/.test(texto)) return null;
  const conEsquema = /^[a-zA-Z]+:\/\//.test(texto) ? texto : `http://${texto}`;
  let url: URL;
  try {
    url = new URL(conEsquema);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  if (!/^[a-zA-Z]+:\/\//.test(texto) && !/^[\w.-]+(:\d+)?$/.test(texto)) return null;
  const puerto = url.port || (/^[a-zA-Z]+:\/\//.test(texto) ? '' : '3000');
  return `${url.protocol}//${url.hostname}${puerto ? `:${puerto}` : ''}`;
}

let enMemoria: string | null = null;

/** Lectura síncrona: el valor persistido ya fue cargado por cargarApiUrl al arrancar. */
export function getApiUrl(): string {
  return enMemoria ?? apiUrlPorDefecto();
}

export function setApiUrlEnMemoria(valor: string | null): void {
  enMemoria = valor;
}

// AsyncStorage arrastra react-native: se carga perezosamente para no romper los tests.
async function storage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

/** Lee el valor persistido. Nunca lanza: si el storage falla se usa el de por defecto. */
export async function cargarApiUrl(): Promise<string> {
  try {
    const guardado = await (await storage()).getItem(CLAVE);
    enMemoria = guardado ? normalizarApiUrl(guardado) : null;
  } catch {
    enMemoria = null;
  }
  return getApiUrl();
}

/** Guarda una dirección normalizada. Devuelve null si la entrada no es válida. */
export async function guardarApiUrl(entrada: string): Promise<string | null> {
  const normal = normalizarApiUrl(entrada);
  if (!normal) return null;
  enMemoria = normal;
  try {
    await (await storage()).setItem(CLAVE, normal);
  } catch {
    // Queda en memoria para esta sesión aunque no se pueda persistir.
  }
  return normal;
}

export async function olvidarApiUrl(): Promise<void> {
  enMemoria = null;
  try {
    await (await storage()).removeItem(CLAVE);
  } catch {
    // sin efecto
  }
}
