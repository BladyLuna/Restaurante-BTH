/**
 * Decorador para leer el usuario autenticado en un handler.
 * Fuente: ARQUITECTURA §6.
 *
 * Por qué importa: la autoría de un cobro sale de acá, nunca del body. Si el
 * cliente pudiera enviar quién confirmó, el AuditLog dejaría de ser prueba.
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UsuarioAutenticado } from './auth.service.js';
import type { RequestConUsuario } from './auth.guard.js';

export const Usuario = createParamDecorator(
  (_dato: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
    const req = ctx.switchToHttp().getRequest<RequestConUsuario>();
    if (req.usuario === undefined) {
      throw new Error(
        'Usuario no disponible: el endpoint corre sin AuthGuard o está marcado @Publico',
      );
    }
    return req.usuario;
  },
);
