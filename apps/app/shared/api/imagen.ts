/**
 * Selector de imagen multiplataforma, para fotos de platos y para el logo.
 *
 * Devuelve `{mime, base64}`, que es exactamente lo que esperan
 * `PUT /admin/products/:id/foto` y `PUT /admin/settings/branding`.
 *
 * POR QUÉ UN INPUT HTML Y NO expo-image-picker
 * --------------------------------------------
 * La demo y el panel de la dueña corren en navegador (web), y el kiosco corre
 * en la tablet. `expo-image-picker` es una dependencia nativa más que habría
 * que instalar, enlazar y volver a compilar el APK; `<input type="file">` ya
 * existe en el navegador y en Android abre la galería y la cámara igual.
 * Cuando haga falta subir fotos desde la app nativa, este archivo es el único
 * lugar que cambia.
 *
 * NO SE MANDA EL NOMBRE DEL ARCHIVO
 * ---------------------------------
 * A propósito: el servidor no acepta ni usa nombres de archivo del cliente
 * (sería la vía directa a un path traversal). Solo viajan el tipo y los bytes.
 */

import {Platform} from 'react-native';

export type ImagenElegida = {mime: string; base64: string; bytes: number};

/** Lo que el servidor acepta, en los dos casos. */
const MIMES = ['image/png', 'image/jpeg', 'image/webp'];

export class ImagenError extends Error {}

/**
 * Abre el selector del sistema y devuelve la imagen elegida, o `null` si la
 * persona canceló.
 *
 * `maxBytes` se verifica acá además del servidor: no para confiar en el
 * cliente, sino para no hacerle subir 6 MB por la red y recién entonces
 * mostrarle el error.
 */
export async function elegirImagen(maxBytes: number): Promise<ImagenElegida | null> {
  if (Platform.OS !== 'web') {
    throw new ImagenError(
      'Por ahora las fotos se suben desde el panel en el navegador. En la tablet se ven, pero no se cargan.',
    );
  }

  const archivo = await abrirSelector();
  if (archivo === null) return null;

  if (!MIMES.includes(archivo.type)) {
    throw new ImagenError(
      `Ese archivo es ${archivo.type || 'de un tipo desconocido'}. Tiene que ser PNG, JPEG o WEBP.`,
    );
  }
  if (archivo.size > maxBytes) {
    throw new ImagenError(
      `La imagen pesa ${Math.round(archivo.size / 1024)} kB y el máximo es ${Math.round(
        maxBytes / 1024,
      )} kB. Elegí una más chica o reducila antes de subirla.`,
    );
  }

  const base64 = await leerBase64(archivo);
  return {mime: archivo.type, base64, bytes: archivo.size};
}

function abrirSelector(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = MIMES.join(',');
    // `capture` hace que en un celular o tablet se ofrezca la cámara directo,
    // que es como la dueña va a fotografiar un plato nuevo.
    input.setAttribute('capture', 'environment');
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // Si cierra el diálogo sin elegir, `change` no dispara nunca: `cancel`
    // existe para no dejar la promesa colgada para siempre.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Lee el archivo y devuelve SOLO el base64, sin el prefijo `data:...;base64,`.
 *
 * El servidor valida con un regex estricto de base64, así que mandar el
 * prefijo daría un 400 con un mensaje confuso.
 */
function leerBase64(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      const texto = String(lector.result);
      const coma = texto.indexOf(',');
      resolve(coma >= 0 ? texto.slice(coma + 1) : texto);
    };
    lector.onerror = () =>
      reject(new ImagenError('No se pudo leer el archivo. Probá con otra imagen.'));
    lector.readAsDataURL(archivo);
  });
}
