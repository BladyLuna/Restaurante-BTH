/**
 * RQ-114 — Guards por rol
 *
 * Fuente: PLAN §5g (matriz de permisos), ARQUITECTURA §6.
 *
 * Regla de diseño: los permisos se declaran sobre el endpoint, no se verifican
 * dentro del servicio. Un `if (user.rol === 'ADMIN')` enterrado en un método
 * es invisible al leer la ruta; un `@Roles('ADMIN')` arriba del handler se ve.
 */

import {
  Injectable,
  Inject,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Rol } from '@prisma/client';
import { AuthService, type UsuarioAutenticado } from './auth.service.js';

export const CLAVE_ROLES = 'roles_permitidos';
export const CLAVE_PUBLICO = 'es_publico';

/** Declara qué roles pueden usar el endpoint. Fuente: PLAN §5g. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

/**
 * Marca un endpoint como público. Se usa solo para el catálogo y la creación
 * de pedidos: el kiosco lo opera el cliente, no un empleado (PLAN §6).
 */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

export type RequestConUsuario = Request & { usuario?: UsuarioAutenticado };

@Injectable()
export class AuthGuard implements CanActivate {
  // @Inject explícito: tsx/esbuild no emite emitDecoratorMetadata, así que
  // Nest no puede inferir los tipos del constructor. Sin esto, el guard
  // arranca con las dependencias en undefined y el primer request revienta.
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(
      CLAVE_PUBLICO,
      [context.getHandler(), context.getClass()],
    );
    if (esPublico === true) return true;

    const req = context.switchToHttp().getRequest<RequestConUsuario>();
    const token = extraerToken(req);

    if (token === null) {
      throw new UnauthorizedException('Falta el token de sesión');
    }

    // Verifica contra la base, no solo la firma: revocación inmediata (RQ-114).
    const usuario = await this.auth.verificarToken(token);
    req.usuario = usuario;

    const rolesPermitidos = this.reflector.getAllAndOverride<Rol[]>(
      CLAVE_ROLES,
      [context.getHandler(), context.getClass()],
    );

    // Sin @Roles: basta estar autenticado.
    if (rolesPermitidos === undefined || rolesPermitidos.length === 0) {
      return true;
    }

    if (!rolesPermitidos.includes(usuario.rol)) {
      throw new ForbiddenException(
        `Tu rol (${usuario.rol}) no tiene acceso a esta operación`,
      );
    }

    return true;
  }
}

function extraerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [tipo, valor] = header.split(' ');
  if (tipo !== 'Bearer' || valor === undefined || valor === '') return null;
  return valor;
}
