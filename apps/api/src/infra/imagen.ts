/**
 * Validación de imágenes subidas: la comparten el logo del local (B5) y las
 * fotos de platos (RQ-206).
 *
 * Existe para no tener dos copias de las firmas binarias. Si mañana se acepta
 * AVIF, se agrega en un solo lugar.
 *
 * SE VALIDA EL CONTENIDO, NO LO QUE DICE EL CLIENTE
 * -------------------------------------------------
 * El `mime` declarado se usa solo para elegir qué firma binaria exigir. Si el
 * cliente dice "image/png" y los primeros bytes no son la firma PNG, se
 * rechaza. Un `.png` que en realidad es un script no pasa.
 *
 * NO HAY NOMBRE DE ARCHIVO EN NINGUNA PARTE
 * -----------------------------------------
 * Ni se acepta ni se genera. Los bytes van a una fila de la base, así que no
 * hay ruta que escapar ni directorio que quede huérfano al restaurar un backup.
 */

import {
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * Firmas binarias de los formatos aceptados.
 *
 * WEBP es un contenedor RIFF: "RIFF" + 4 bytes de tamaño + "WEBP", así que se
 * verifica en dos tramos salteando el tamaño.
 */
const FIRMAS: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) =>
    b.length >= 8 &&
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) =>
    b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) =>
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** Una imagen ya validada, lista para guardar en `Setting.valor`. */
export type ImagenValidada = {
  mime: string;
  base64: string;
  /** Hash del contenido. Va en la URL para invalidar la caché del cliente. */
  version: string;
  bytes: number;
};

/**
 * Decodifica y valida. `que` nombra el objeto en los mensajes de error ("la
 * foto", "el logo") para que el panel muestre algo que la dueña entienda.
 *
 * Orden deliberado: tamaño antes que firma, para que un archivo enorme se
 * rechace con 413 ("pesa demasiado") y no con un 400 confuso.
 */
export function validarImagen(
  entrada: { mime: string; base64: string },
  maxBytes: number,
  que: string,
): ImagenValidada {
  const limpio = entrada.base64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpio)) {
    throw new BadRequestException(`El contenido de ${que} no es base64 válido`);
  }

  const contenido = Buffer.from(limpio, 'base64');
  if (contenido.length === 0) {
    throw new BadRequestException(`${que} llegó vacía`);
  }
  if (contenido.length > maxBytes) {
    throw new PayloadTooLargeException(
      `${que} pesa ${Math.round(contenido.length / 1024)} kB y el máximo es ${Math.round(
        maxBytes / 1024,
      )} kB. Reducí la imagen antes de subirla.`,
    );
  }

  const verificar = FIRMAS[entrada.mime];
  if (verificar === undefined) {
    throw new BadRequestException(`Formato no aceptado para ${que}`);
  }

  // La verdad es el contenido, no el `mime` que mandó el cliente.
  if (!verificar(contenido)) {
    throw new BadRequestException(
      `El archivo no es un ${entrada.mime
        .replace('image/', '')
        .toUpperCase()} válido: su contenido no coincide con el formato declarado`,
    );
  }

  return {
    mime: entrada.mime,
    base64: contenido.toString('base64'),
    version: createHash('sha256').update(contenido).digest('hex').slice(0, 16),
    bytes: contenido.length,
  };
}
