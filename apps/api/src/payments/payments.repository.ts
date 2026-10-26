import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { limiteDePago } from './domain/confirmacion.js';

@Injectable()
export class PaymentsRepository {
  async limite(tx: Prisma.TransactionClient) {
    const setting = await tx.setting.findUnique({ where: { clave: 'pedido.timeout_minutos' } });
    return limiteDePago(new Date(), setting?.valor ?? 15);
  }
  async candidatos(tx: Prisma.TransactionClient, locationId: string, total: number) {
    const limite = await this.limite(tx);
    return tx.order.findMany({ where: { locationId, total, estado: 'PENDIENTE_PAGO', creadoEn: { gt: limite } },
      include: { items: true }, orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }] });
  }
}