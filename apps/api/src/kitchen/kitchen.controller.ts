import { Controller, Get, Inject, Patch, Param, Body, Ip, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ESTADOS } from '@restaurante/shared';
import { Roles } from '../auth/auth.guard.js';
import { Usuario } from '../auth/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/auth.service.js';
import { KitchenService } from './kitchen.service.js';
@Controller('kitchen/orders')
@Roles('COCINA', 'CAJA', 'ADMIN')
export class KitchenController {
  constructor(@Inject(KitchenService) private readonly kitchen: KitchenService) {}
  @Patch(':id/estado')
  cambiar(@Param('id') id: string, @Body() body: unknown, @Usuario() usuario: UsuarioAutenticado, @Ip() ip: string) {
    const dto = z.object({ estado: z.enum(ESTADOS) }).strict().safeParse(body);
    if (!dto.success) throw new BadRequestException('Estado inválido');
    return this.kitchen.cambiar(id, dto.data.estado, usuario, ip);
  }
  @Get()
  cola(@Usuario() usuario: UsuarioAutenticado) { return this.kitchen.cola(usuario.locationId); }
}
