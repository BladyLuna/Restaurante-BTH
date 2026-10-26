import { Body, Controller, HttpCode, Inject, Post, Get, Query, BadRequestException } from '@nestjs/common';
import { PaymentSchemas } from '@restaurante/shared';
import type { ZodType } from 'zod';
import { Roles } from '../auth/auth.guard.js';
import { Usuario } from '../auth/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/auth.service.js';
import { PaymentsService } from './payments.service.js';

function validar<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.errors[0]?.message ?? 'Datos inválidos');
  return result.data;
}

@Controller('admin/payments')
@Roles('ADMIN', 'CAJA')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}
  @Get('buscar')
  buscar(@Usuario() usuario: UsuarioAutenticado, @Query() query: unknown) {
    return this.payments.buscar(usuario, validar(PaymentSchemas.BuscarPorMonto, query).total);
  }
  @Post('confirmar')
  @HttpCode(200)
  confirmar(@Usuario() usuario: UsuarioAutenticado, @Body() body: unknown) {
    const dto = validar(PaymentSchemas.ConfirmarPago, body);
    return this.payments.confirmar(usuario, dto.montoRecibido, dto.orderId);
  }
  @Post('confirmar-por-monto')
  @HttpCode(200)
  confirmarPorMonto(@Usuario() usuario: UsuarioAutenticado, @Body() body: unknown) {
    return this.payments.confirmarPorMonto(usuario, validar(PaymentSchemas.ConfirmarPorMonto, body).montoRecibido);
  }
  @Roles('ADMIN')
  @Post('confirmar-con-diferencia')
  @HttpCode(200)
  diferencia(@Usuario() usuario: UsuarioAutenticado, @Body() body: unknown) {
    const dto = validar(PaymentSchemas.ConfirmarConDiferencia, body);
    return this.payments.confirmar(usuario, dto.montoRecibido, dto.orderId, dto.motivo);
  }
}