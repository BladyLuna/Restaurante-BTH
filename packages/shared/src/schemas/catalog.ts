/**
 * RQ-104 / RQ-207 — Schemas de validación compartidos
 *
 * Fuente: PLAN §6 ("la validación es la misma en el cliente y el servidor"),
 *         ARQUITECTURA §6, D-04.
 *
 * Por qué viven en shared: el kiosco valida para dar feedback inmediato, el
 * servidor valida porque es la autoridad. Si fueran dos schemas distintos,
 * tarde o temprano divergen y el cliente deja pasar algo que el servidor
 * rechaza con un error que la UI no sabe mostrar.
 */

import { z } from 'zod';

/**
 * Precio en centavos. Entero positivo y múltiplo de 100 (D-04).
 *
 * El mensaje explica el por qué, no solo que falló: quien lo vea en el panel
 * tiene que entender que no es un bug sino una regla.
 */
export const PrecioCentavos = z
  .number()
  .int('El precio debe ser un número entero de centavos')
  .positive('El precio debe ser mayor a cero')
  .refine((v) => v % 100 === 0, {
    message:
      'Los precios son bolivianos enteros, sin centavos. Bs 45 se guarda como 4500.',
  });

/** Precio en bolivianos, tal como lo tipea la dueña en el panel. */
export const PrecioBolivianos = z
  .number()
  .int('El precio debe ser un número entero de bolivianos')
  .positive('El precio debe ser mayor a cero')
  .max(100_000, 'El precio parece demasiado alto, verificalo');

const nombreCorto = z
  .string()
  .trim()
  .min(1, 'El nombre no puede estar vacío')
  .max(80, 'El nombre es demasiado largo');

const orden = z.number().int().min(0).default(0);

// ---------------------------------------------------------------------------
// Categorías — RQ-201
// ---------------------------------------------------------------------------

export const CrearCategoria = z.object({
  nombre: nombreCorto,
  orden: orden.optional(),
});

export const ActualizarCategoria = z.object({
  nombre: nombreCorto.optional(),
  orden: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Platos — RQ-202
// ---------------------------------------------------------------------------

export const CrearProducto = z.object({
  categoryId: z.string().min(1, 'Falta la categoría'),
  nombre: nombreCorto,
  descripcion: z.string().trim().max(300).nullish(),
  /** En bolivianos enteros: el panel no pide centavos. */
  precioBolivianos: PrecioBolivianos,
  orden: orden.optional(),
});

export const ActualizarProducto = z.object({
  nombre: nombreCorto.optional(),
  descripcion: z.string().trim().max(300).nullish(),
  precioBolivianos: PrecioBolivianos.optional(),
  categoryId: z.string().min(1).optional(),
  orden: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Variantes — RQ-203
// ---------------------------------------------------------------------------

export const CrearVariante = z.object({
  nombre: nombreCorto,
  precioBolivianos: PrecioBolivianos,
  orden: orden.optional(),
});

export const ActualizarVariante = z.object({
  nombre: nombreCorto.optional(),
  precioBolivianos: PrecioBolivianos.optional(),
  orden: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Activar / desactivar — RQ-204
// ---------------------------------------------------------------------------

/**
 * Nunca hay borrado. Fuente: PLAN §4 "nunca borrar platos" — un plato borrado
 * dejaría OrderItem huérfanos y corrompería los reportes históricos.
 */
export const CambiarActivo = z.object({
  activo: z.boolean(),
});

// ---------------------------------------------------------------------------
// Reordenar — RQ-205
// ---------------------------------------------------------------------------

/**
 * El cliente manda el orden resultante completo, no índices relativos
 * (S2 RQ-205). Así dos personas reordenando a la vez no producen un orden
 * intermedio inconsistente.
 */
export const Reordenar = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, 'Hace falta al menos un elemento')
    .max(500),
});

// ---------------------------------------------------------------------------
// Foto del plato — RQ-206
// ---------------------------------------------------------------------------

/**
 * Formatos aceptados para la foto de un plato. Los mismos que el logo (B5):
 * son los que cualquier cámara de celular produce y los tres los decodifica
 * todo navegador.
 */
export const MIMES_FOTO = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type MimeFoto = (typeof MIMES_FOTO)[number];

/**
 * Tope de la foto ya decodificada.
 *
 * Más alto que el del logo (2 MB) porque una foto de plato sacada con el
 * celular en el local pesa más que un logo, y obligar a la dueña a redimensionar
 * antes de subir haría que no suba fotos. Pero sigue siendo un tope duro: sin
 * él, esta tabla se convierte en un almacén de imágenes por la ventana.
 */
export const FOTO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * La foto llega como base64 en JSON, igual que el logo.
 *
 * `.strict()` a propósito, y en particular NO existe un campo de nombre de
 * archivo: el servidor nunca usa un nombre que venga del cliente, porque sería
 * la vía directa a un path traversal.
 */
export const SubirFoto = z
  .object({
    mime: z.enum(MIMES_FOTO, {
      errorMap: () => ({ message: 'La foto debe ser PNG, JPEG o WEBP' }),
    }),
    /** Contenido del archivo en base64, sin el prefijo `data:`. */
    base64: z.string().min(1, 'La foto llegó vacía'),
  })
  .strict();

export type SubirFotoDto = z.infer<typeof SubirFoto>;

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type CrearCategoriaDto = z.infer<typeof CrearCategoria>;
export type ActualizarCategoriaDto = z.infer<typeof ActualizarCategoria>;
export type CrearProductoDto = z.infer<typeof CrearProducto>;
export type ActualizarProductoDto = z.infer<typeof ActualizarProducto>;
export type CrearVarianteDto = z.infer<typeof CrearVariante>;
export type ActualizarVarianteDto = z.infer<typeof ActualizarVariante>;
export type CambiarActivoDto = z.infer<typeof CambiarActivo>;
export type ReordenarDto = z.infer<typeof Reordenar>;
