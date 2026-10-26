/**
 * Endpoints del reporte de auditoría.
 *
 * Fuente: PLAN §5c, §5g (matriz de permisos).
 *
 * Los permisos se declaran acá, sobre la ruta, no dentro del servicio
 * (ARQUITECTURA §6).
 *
 * Quién puede qué:
 *   GET /admin/audit   ADMIN — el log responde "quién cambió este precio" y
 *                      "quién confirmó este cobro". Dárselo a CAJA sería dejar
 *                      que quien confirma pagos lea y audite su propio rastro,
 *                      y el log existe precisamente para supervisarla
 *                      (D-02, D-15). COCINA no tiene nada que hacer acá.
 *
 * Es de solo lectura por diseño: no hay POST, PUT ni DELETE. Un log que se
 * puede editar o borrar desde la API no prueba nada — y la escritura ya ocurre
 * dentro de la transacción de cada evento (D-07).
 */

import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
} from '@nestjs/common';
import { AuditSchemas, type ReporteAuditoriaDto } from '@restaurante/shared';
import { Roles } from '../auth/auth.guard.js';
import { AuditService } from './audit.service.js';

@Controller()
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Roles('ADMIN')
  @Get('admin/audit')
  async reporte(
    @Query() query: Record<string, string>,
  ): Promise<ReporteAuditoriaDto> {
    // `dias` llega como string por la query. Se convierte antes de validar para
    // que el schema siga siendo el mismo objeto que valida el panel.
    const crudo = {
      ...query,
      ...(query.dias === undefined ? {} : { dias: Number(query.dias) }),
    };

    const r = AuditSchemas.ConsultarAuditoria.safeParse(crudo);
    if (!r.success) {
      throw new BadRequestException(
        r.error.issues.map((i) => i.message).join('. '),
      );
    }

    return this.audit.reporte(r.data);
  }
}
