/**
 * Endpoints de autenticación.
 * Fuente: PLAN §6.
 */

import {
  Controller,
  Inject,
  Post,
  Get,
  Body,
  Req,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService, type UsuarioAutenticado } from './auth.service.js';
import { Publico } from './auth.guard.js';
import { Usuario } from './usuario.decorator.js';

const LoginSchema = z.object({
  pin: z.string().min(4).max(12),
});

const CambiarPinSchema = z.object({
  pinActual: z.string().min(4).max(12),
  pinNuevo: z.string().min(4).max(12),
});

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ token: string; usuario: UsuarioAutenticado }> {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('PIN inválido');
    }
    return this.auth.login(parsed.data.pin, origenDe(req));
  }

  @Get('yo')
  async yo(@Usuario() usuario: UsuarioAutenticado): Promise<UsuarioAutenticado> {
    return this.auth.yo(usuario.id);
  }

  @Post('cambiar-pin')
  @HttpCode(204)
  async cambiarPin(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: unknown,
  ): Promise<void> {
    const parsed = CambiarPinSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Datos inválidos');
    }
    await this.auth.cambiarPinPropio(
      usuario.id,
      parsed.data.pinActual,
      parsed.data.pinNuevo,
    );
  }
}

/**
 * Identifica el origen para el rate limit. En la LAN del local la IP
 * identifica al dispositivo, que es la granularidad útil.
 */
function origenDe(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded !== '') {
    const primera = forwarded.split(',')[0];
    if (primera !== undefined) return primera.trim();
  }
  return req.ip ?? 'desconocido';
}
