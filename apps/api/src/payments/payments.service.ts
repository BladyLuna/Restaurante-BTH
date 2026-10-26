import { Inject, Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';
import type { UsuarioAutenticado } from '../auth/auth.service.js';
import { PaymentsRepository } from './payments.repository.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class PaymentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsRepository) private readonly repo: PaymentsRepository) {}

  confirmarPorMonto(usuario: UsuarioAutenticado, montoRecibido: number) {
    return this.confirmar(usuario, montoRecibido);
  }

  buscar(usuario: UsuarioAutenticado, total: number) {
    return this.prisma.$transaction(async tx => {
      const pedidos = await this.repo.candidatos(tx, usuario.locationId, total);
      return { pedidos, cantidad: pedidos.length, ambiguo: pedidos.length > 1 };
    });
  }

  async confirmar(usuario: UsuarioAutenticado, montoRecibido: number, orderId?: string, motivo?: string) {
    try {
      return await this.prisma.$transaction(async tx => {
      // FOR SHARE deja confirmar en paralelo, pero serializa desactivación/cambio
      // de rol/local contra el cobro. No basta la comprobación anterior del guard.
      const actores = await tx.$queryRaw<{ id: string; rol: string; activo: boolean; locationId: string }[]>`
        SELECT id, rol, activo, "locationId" FROM users WHERE id = ${usuario.id} FOR SHARE
      `;
      const actor = actores[0];
      if (!actor?.activo || actor.locationId !== usuario.locationId || actor.rol !== usuario.rol ||
          !['ADMIN', 'CAJA'].includes(actor.rol) || (motivo !== undefined && actor.rol !== 'ADMIN')) {
        throw new ForbiddenException('El permiso de confirmar pagos cambió');
      }
      const elegido = orderId ? await tx.order.findFirst({ where: { id: orderId, locationId: usuario.locationId } }) : null;
      const candidatos = await this.repo.candidatos(tx, usuario.locationId, elegido?.total ?? montoRecibido);
      const pedido = orderId ? candidatos.find(p => p.id === orderId) : candidatos[0];
      if (!pedido || (!orderId && candidatos.length !== 1)) throw new ConflictException('Elegí explícitamente un pedido');
      if (!motivo && pedido.total !== montoRecibido) throw new ConflictException('El monto debe coincidir exactamente');
      const cambio = await tx.order.updateMany({ where: { id: pedido.id, locationId: usuario.locationId,
        estado: 'PENDIENTE_PAGO', creadoEn: { gt: await this.repo.limite(tx) } }, data: {
        estado: 'PAGADO', pagadoEn: new Date(), confirmadoPorId: usuario.id,
        montoRecibido: motivo ? montoRecibido : null,
      } });
      if (cambio.count !== 1) throw new ConflictException('El pedido cambió o venció; volvé a consultar');
      await tx.auditLog.create({ data: { userId: usuario.id, orderId: pedido.id,
        accion: motivo ? 'PAGO_CONFIRMADO_CON_DIFERENCIA' : 'PAGO_CONFIRMADO', montoEsperado: pedido.total, montoRecibido,
        detalle: { candidatos: candidatos.length, candidatosIds: candidatos.map(p => p.id),
          ambiguo: candidatos.length > 1, seleccionExplicita: !!orderId, ...(motivo ? { motivo } : {}) } } });
      return tx.order.findUniqueOrThrow({ where: { id: pedido.id } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      // No reintentar automáticamente: la lista que vio el humano puede haber cambiado.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        throw new ConflictException('Los pedidos cambiaron durante la confirmación; volvé a consultar');
      }
      throw error;
    }
  }
}