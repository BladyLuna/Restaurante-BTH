/**
 * B5 — schemas de branding del local (nombre + logo)
 *
 * Fuente: ARQUITECTURA §1 ("la configuración vive en tabla, no en .env, para
 * que la dueña pueda cambiarla sin reiniciar nada"), PLAN §5g.
 *
 * Viven en shared porque el panel valida para dar feedback inmediato y el
 * servidor valida porque es la autoridad (PLAN §6). Un schema distinto en cada
 * lado divergiría y el panel dejaría pasar algo que la API rechaza.
 *
 * El schema es `.strict()` a propósito: cualquier campo extra que mande el
 * cliente es un error, no algo a ignorar. En particular NO existe un campo de
 * nombre de archivo — el servidor nunca usa un nombre que venga del cliente,
 * porque sería la vía directa a un path traversal.
 */

import { z } from 'zod';

/** Tipos de imagen aceptados para el logo. */
export const MIMES_LOGO = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type MimeLogo = (typeof MIMES_LOGO)[number];

/** Límite del logo ya decodificado. Un logo es un logo, no una foto de catálogo. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const LogoSubido = z
  .object({
    mime: z.enum(MIMES_LOGO, {
      errorMap: () => ({
        message: 'El logo debe ser PNG, JPEG o WEBP',
      }),
    }),
    /** Contenido del archivo en base64, sin prefijo `data:`. */
    base64: z.string().min(1, 'El logo llegó vacío'),
  })
  .strict();

const nombreLocal = z
  .string()
  .trim()
  .min(1, 'El nombre del local no puede estar vacío')
  .max(80, 'El nombre del local es demasiado largo');

/**
 * Los dos campos son opcionales para poder cambiar uno sin reenviar el otro
 * (cambiar el logo no debe borrar el nombre). `logo: null` quita el logo.
 * Pero un body sin ningún campo no es un cambio: es un error del cliente.
 */
export const ActualizarBranding = z
  .object({
    nombreLocal: nombreLocal.optional(),
    logo: LogoSubido.nullable().optional(),
  })
  .strict()
  .refine((v) => v.nombreLocal !== undefined || v.logo !== undefined, {
    message: 'No hay nada que cambiar: enviá nombreLocal y/o logo',
  });

export type ActualizarBrandingDto = z.infer<typeof ActualizarBranding>;
export type LogoSubidoDto = z.infer<typeof LogoSubido>;

/** Lo que devuelven GET /settings/branding y PUT /admin/settings/branding. */
export type BrandingDto = {
  nombreLocal: string;
  /**
   * Ruta relativa que empieza con '/'. El cliente arma la URL final como
   * API_URL + logoUrl, igual que con imagenUrl de productos y qrImagenUrl.
   * null si la dueña todavía no subió ningún logo.
   */
  logoUrl: string | null;
};
