/**
 * B10 — schemas del reporte de auditoría
 *
 * Fuente: PLAN §5c (el log existe "para poder explicar un cierre que no
 * cuadra"), §5g (matriz de permisos), D-07 (la auditoría financiera se escribe
 * dentro de la transacción).
 *
 * Viven en shared por la misma razón que los de branding: el panel valida para
 * dar feedback inmediato y el servidor valida porque es la autoridad.
 *
 * El schema es `.strict()`: un filtro desconocido es un error, no algo a
 * ignorar. Si el panel manda `?usuario=` y la API lo descarta en silencio, la
 * dueña cree que está viendo un log filtrado cuando ve el completo — y eso es
 * peor que un error.
 */

import { z } from 'zod';

/**
 * Acciones que el reporte sabe agrupar.
 *
 * No es el enum completo de la base a propósito: el reporte de la dueña agrupa
 * por lo que ella entiende ("dinero", "carta", "accesos"), no por el nombre
 * técnico de cada acción. El enum de Prisma sigue siendo la fuente de verdad de
 * lo que se puede escribir; esto es solo la lente para leerlo.
 */
export const GRUPOS_AUDITORIA = ['DINERO', 'CARTA', 'ACCESOS', 'TODO'] as const;
export type GrupoAuditoria = (typeof GRUPOS_AUDITORIA)[number];

/**
 * Qué acción cae en qué grupo.
 *
 * Mapa explícito en vez de heurística sobre el nombre: si mañana alguien agrega
 * `PRECIO_REVERTIDO` al enum, es mejor que no aparezca en ningún grupo y se
 * note, que aparezca en el grupo equivocado porque el nombre contenía "PRECIO".
 */
export const ACCIONES_POR_GRUPO = {
  DINERO: [
    'PAGO_CONFIRMADO',
    'PAGO_CONFIRMADO_CON_DIFERENCIA',
    'PEDIDO_CANCELADO',
    'REFUND_CREADO',
    'REFUND_CERRADO',
    'QR_ACTIVADO',
    'QR_ARCHIVADO',
    'QR_SUBIDO',
    'COMPROBANTE_ADJUNTADO',
  ],
  CARTA: ['PRECIO_CAMBIADO', 'PRODUCTO_ACTIVADO', 'PRODUCTO_DESACTIVADO'],
  ACCESOS: [
    'USUARIO_CREADO',
    'USUARIO_DESACTIVADO',
    'PERMISO_OTORGADO',
    'PERMISO_REVOCADO',
    'PIN_RESETEADO',
    'LOGIN_FALLIDO',
    'LOGIN_BLOQUEADO',
  ],
} as const;

/**
 * Tamaño de página.
 *
 * Fijo y chico a propósito. El log crece sin techo —cada login fallido escribe
 * una fila— y una pantalla que haga `findMany` sin `take` se vuelve más lenta
 * cada día que el sistema opera. 25 filas entran en una pantalla sin scroll
 * infinito y mantienen la respuesta por debajo de los 50 ms contra el índice
 * `(accion, creadoEn)`.
 */
export const AUDITORIA_POR_PAGINA = 25;

/** Techo duro del rango consultable, en días. */
export const AUDITORIA_DIAS_MAX = 90;

export const ConsultarAuditoria = z
  .object({
    grupo: z.enum(GRUPOS_AUDITORIA).default('TODO'),
    /**
     * Cursor de paginación: el `creadoEn` ISO de la última fila ya mostrada.
     *
     * Paginación por cursor y no por `skip`/`offset`: con offset, la página 20
     * obliga a Postgres a leer y descartar 500 filas, y el costo crece con el
     * número de página. Con cursor es un seek directo sobre el índice de
     * `creadoEn`, constante sin importar cuán atrás se vaya.
     */
    cursor: z.string().datetime({ offset: true }).optional(),
    dias: z.number().int().min(1).max(AUDITORIA_DIAS_MAX).default(7),
  })
  .strict();

export type ConsultarAuditoriaDto = z.infer<typeof ConsultarAuditoria>;

/**
 * Una fila del reporte, ya traducida a lenguaje de la dueña.
 *
 * El servidor hace la traducción, no el panel. Si el texto se armara en el
 * cliente, el mismo evento se leería distinto en el celular de la dueña y en
 * la laptop de caja, y un reporte que se lee distinto según el dispositivo no
 * sirve para resolver una discusión sobre dinero.
 */
export type EntradaAuditoriaDto = {
  id: string;
  accion: string;
  grupo: GrupoAuditoria;
  /** Una línea en lenguaje llano: "Cambió el precio de Pollo: Bs 35 → Bs 40". */
  resumen: string;
  /** Quién lo hizo. `null` cuando el actor es el sistema (expiración, timeout). */
  autor: string | null;
  rolAutor: string | null;
  /** ISO. El panel formatea según la zona del dispositivo. */
  creadoEn: string;
  /** Número de pedido afectado, cuando el evento es de un pedido. */
  numeroPedido: number | null;
  /** Solo en confirmaciones con diferencia. Centavos. */
  montoEsperado: number | null;
  montoRecibido: number | null;
};

export type ReporteAuditoriaDto = {
  entradas: EntradaAuditoriaDto[];
  /** Cursor para la página siguiente. `null` cuando no hay más. */
  siguienteCursor: string | null;
  /**
   * Conteo por grupo en el rango consultado, para los contadores de las
   * pestañas. Se calcula con `groupBy`, no trayendo las filas.
   */
  totales: { DINERO: number; CARTA: number; ACCESOS: number; TODO: number };
};
