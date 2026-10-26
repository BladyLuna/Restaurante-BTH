/**
 * Endpoints de branding del local.
 * Fuente: PLAN §534 (`GET/PUT /admin/settings`), §5g (matriz de permisos).
 *
 * Los permisos se declaran acá, sobre la ruta, no dentro del servicio
 * (ARQUITECTURA §6).
 *
 * Quién puede qué:
 *   GET /settings/branding        público — lo pinta el kiosco antes del login
 *   GET /settings/branding/logo   público — es la imagen que pinta el kiosco
 *   PUT /admin/settings/branding  ADMIN — la identidad del local es decisión
 *                                 de la dueña, misma fila que "gestionar
 *                                 catálogo y precios" (PLAN §5g)
 */

import {
  Controller,
  Inject,
  Get,
  Put,
  Body,
  Ip,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { SettingsSchemas, type BrandingDto } from '@restaurante/shared';
import { Publico, Roles } from '../auth/auth.guard.js';
import { Usuario } from '../auth/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/auth.service.js';
import { SettingsService } from './settings.service.js';

@Controller()
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Lo consume el kiosco sin sesión, en el primer render. */
  @Publico()
  @Get('settings/branding')
  async branding(): Promise<BrandingDto> {
    return this.settings.branding();
  }

  /**
   * La imagen misma. Público por la misma razón que el catálogo: el kiosco lo
   * opera el cliente, no un empleado (PLAN §6).
   *
   * El `?v=` del hash hace la URL única por contenido, así que se puede cachear
   * agresivamente: cuando la dueña cambie el logo, cambia la URL y el cliente
   * baja la nueva sin tener que invalidar nada.
   */
  @Publico()
  @Get('settings/branding/logo')
  async logo(@Res() res: Response): Promise<void> {
    const { mime, contenido, version } = await this.settings.logo();
    res
      .type(mime)
      .set('Cache-Control', 'public, max-age=31536000, immutable')
      .set('ETag', `"${version}"`)
      // Nunca se expone ni se acepta un nombre de archivo del cliente: el logo
      // se sirve inline con un nombre fijo que genera el servidor.
      .set('Content-Disposition', 'inline')
      .send(contenido);
  }

  @Roles('ADMIN')
  @Put('admin/settings/branding')
  async actualizar(
    @Body() body: unknown,
    @Usuario() usuario: UsuarioAutenticado,
    @Ip() ip: string,
  ): Promise<BrandingDto> {
    const r = SettingsSchemas.ActualizarBranding.safeParse(body);
    if (!r.success) {
      throw new BadRequestException(
        r.error.errors[0]?.message ?? 'Datos de branding inválidos',
      );
    }
    return this.settings.actualizarBranding(r.data, usuario, ip);
  }
}
