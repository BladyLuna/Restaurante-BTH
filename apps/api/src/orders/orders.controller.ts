/**
 * Endpoints de pedidos (B7).
 * Fuente: `PLAN §6`, `PLAN §7`, `ARQUITECTURA §6`, RQ-301 a RQ-312.
 *
 * Los permisos se declaran acá, sobre la ruta, no dentro del servicio
 * (`ARQUITECTURA §6`).
 *
 * Quién puede qué:
 *   POST /orders                público — el cliente del kiosco no se loguea
 *   GET  /orders/:id/estado     público — su propio pedido, datos que ya vio
 *   GET  /admin/orders/...      ADMIN y CAJA — el panel de cobro lo usan las dos
 *   POST /admin/orders/:id/cancelar   solo ADMIN (RQ-309)
 *   POST /admin/orders/:id/repetir    ADMIN y CAJA (D-12)
 *
 * Por qué `cancelar` es solo ADMIN y `repetir` también lo puede CAJA: cancelar
 * cierra un pedido y es una decisión comercial; repetir solo crea uno nuevo en
 * estado pendiente, que es lo que la cajera necesita cuando llega un pago tarde
 * (D-12). Ninguna de las dos toca plata.
 */

import {
  Controller,
  Inject,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { OrderSchemas } from '@restaurante/shared';
import { Publico, Roles } from '../auth/auth.guard.js';
import { Usuario } from '../auth/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/auth.service.js';
import { OrdersService } from './orders.service.js';
import { z, type ZodType } from 'zod';

function validar<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) {
    const primero = r.error.errors[0];
    throw new BadRequestException(primero?.message ?? 'Datos inválidos');
  }
  return r.data;
}

const CancelarPedido = z.object({
  motivo: z
    .string()
    .trim()
    .min(3, 'Escribí por qué lo cancelás: queda en el registro')
    .max(200),
});

const RepetirPedido = z.object({
  intentoUuid: z.string().uuid('El identificador del intento no es válido'),
});

@Controller()
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
  ) {}

  // -------------------------------------------------------------------------
  // Público — el kiosco
  // -------------------------------------------------------------------------

  /**
   * RQ-301 — Crear pedido. Ruta pública (`PLAN §7`): el cliente no tiene cuenta.
   *
   * Devuelve 200 y no 201 a propósito: en un reintento (RQ-303) devuelve el
   * pedido que ya existía, y un 201 ahí mentiría diciendo que se creó algo.
   */
  @Publico()
  @Post('orders')
  @HttpCode(200)
  async crear(@Body() body: unknown) {
    return this.orders.crear(validar(OrderSchemas.CrearPedido, body));
  }

  /** RQ-307 — El kiosco pregunta si ya le confirmaron el pago. */
  @Publico()
  @Get('orders/:id/estado')
  async estado(@Param('id') id: string) {
    return this.orders.estadoPublico(id);
  }

  // -------------------------------------------------------------------------
  // Panel de cobro — ADMIN y CAJA
  // -------------------------------------------------------------------------

  /** RQ-308 — Cola de pendientes de la jornada. */
  @Roles('ADMIN', 'CAJA')
  @Get('admin/orders/pendientes')
  async pendientes(@Usuario() usuario: UsuarioAutenticado) {
    return this.orders.pendientes(usuario.locationId);
  }

  /**
   * RQ-311 / R-01 — Buscar por monto.
   *
   * El monto va en centavos. Devuelve lista y bandera `ambiguo`: con dos
   * pedidos del mismo total, quien confirma TIENE que elegir (`PLAN §5b`).
   */
  @Roles('ADMIN', 'CAJA')
  @Get('admin/orders/buscar')
  async buscar(
    @Usuario() usuario: UsuarioAutenticado,
    @Query('total') total: string,
  ) {
    const centavos = Number(total);
    if (!Number.isInteger(centavos) || centavos <= 0) {
      throw new BadRequestException('El monto a buscar no es válido');
    }
    return this.orders.buscarPorMonto(usuario.locationId, centavos);
  }

  /**
   * RQ-309 — Cancelación manual. Solo ADMIN.
   *
   * CAJA no cancela: un pedido cancelado es plata que no entró, y la cajera no
   * decide sobre la venta (`PLAN §5c`, C-04).
   */
  @Roles('ADMIN')
  @Post('admin/orders/:id/cancelar')
  @HttpCode(200)
  async cancelar(
    @Usuario() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const dto = validar(CancelarPedido, body);
    return this.orders.cancelar(id, usuario.id, dto.motivo);
  }

  /**
   * RQ-310 / D-12 — Repetir un pedido vencido cuando el pago llega tarde.
   *
   * Crea uno NUEVO con los mismos ítems; el original queda cancelado y
   * trazable. No revive nada (`CANCELADO` es terminal, RQ-102).
   */
  @Roles('ADMIN', 'CAJA')
  @Post('admin/orders/:id/repetir')
  @HttpCode(200)
  async repetir(@Param('id') id: string, @Body() body: unknown) {
    const dto = validar(RepetirPedido, body);
    return this.orders.repetir(id, dto.intentoUuid);
  }

  /**
   * RQ-306 — Dispara la cancelación de vencidos.
   *
   * Endpoint manual por ahora. El job programado va en S10 (O3); exponerlo como
   * ruta permite probar la regla hoy sin montar un scheduler.
   */
  @Roles('ADMIN')
  @Post('admin/orders/cancelar-vencidos')
  @HttpCode(200)
  async cancelarVencidos(@Usuario() usuario: UsuarioAutenticado) {
    return this.orders.cancelarVencidos(usuario.locationId);
  }
}
