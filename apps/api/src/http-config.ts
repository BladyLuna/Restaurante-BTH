/**
 * Configuración HTTP compartida entre main.ts y los tests.
 *
 * Por qué existe: el límite de body de express es 100 kB por defecto. Un logo
 * de 2 MB en base64 pesa ~2.7 MB y el parser lo rechazaría antes de que
 * nuestra validación lo vea, devolviendo un 413 genérico sin explicación.
 * Y si el test usara un límite distinto al de producción, estaría probando
 * otra aplicación.
 */

import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';

/**
 * Techo del body JSON. Holgado respecto del límite real del logo (2 MB de
 * imagen) para que el rechazo lo haga nuestra validación con un mensaje que la
 * dueña entienda, no el parser.
 */
export const LIMITE_BODY = '6mb';

export function configurarBodyParser(app: NestExpressApplication): void {
  app.use(json({ limit: LIMITE_BODY }));
  app.use(urlencoded({ extended: true, limit: LIMITE_BODY }));
}
