import { Inject, Injectable, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ESTADOS_COCINA, puedeTransicionar, actorPuedeTransicionar, type EstadoPedido } from '@restaurante/shared';
import type { Order, OrderItem } from '@prisma/client';
import type { UsuarioAutenticado } from '../auth/auth.service.js';
import { PrismaService } from '../infra/prisma.service.js';

@Injectable()
export class KitchenService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async cambiar(id: string, estado: EstadoPedido, usuario: UsuarioAutenticado, ip?: string) {
    return this.prisma.$transaction(async tx => {
      const p = await tx.order.findFirst({ where: { id, locationId: usuario.locationId }, include: { items: true } });
      if (!p) throw new NotFoundException('Ese pedido no existe');
      // Este endpoint nunca confirma pagos ni cancela: tienen su propio flujo financiero.
      if (!['EN_PREPARACION', 'LISTO', 'ENTREGADO'].includes(estado)) {
        throw new ForbiddenException('Operación fuera del flujo de cocina');
      }
      if (!puedeTransicionar(p.estado, estado)) throw new ConflictException('Transición inválida');
      if (!actorPuedeTransicionar(p.estado, estado, usuario.rol)) throw new ForbiddenException('Actor no autorizado');
      const cambio = await tx.order.updateMany({
        where: { id, locationId: usuario.locationId, estado: p.estado }, data: { estado },
      });
      if (cambio.count !== 1) throw new ConflictException('El pedido cambió; actualizá la cola');
      if (estado === 'ENTREGADO') {
        await tx.auditLog.create({ data: { orderId: id, userId: usuario.id, accion: 'PEDIDO_ENTREGADO',
          ip: ip ?? null, detalle: { desde: p.estado, hacia: estado } } });
      }
      return presentar({ ...p, estado });
    });
  }
  async cola(locationId: string) {
    const orders = await this.prisma.order.findMany({
      where: { locationId, estado: { in: [...ESTADOS_COCINA] } }, include: { items: true },
      orderBy: [{ pagadoEn: 'asc' }, { creadoEn: 'asc' }, { id: 'asc' }],
    });
    return orders.map(presentar);
  }
}
function presentar(p: Order & { items: OrderItem[] }) {
  return {
    id: p.id, numero: p.numero, estado: p.estado, tipo: p.tipo,
    nombreCliente: p.nombreCliente, total: p.total, subtotal: p.subtotal,
    creadoEn: p.creadoEn, pagadoEn: p.pagadoEn,
    minutosEspera: p.pagadoEn ? Math.max(0, Math.floor((Date.now() - p.pagadoEn.getTime()) / 60_000)) : null,
    items: p.items.map(i => ({ id: i.id, nombre: i.nombreSnapshot, cantidad: i.cantidad,
      precioUnitario: i.precioUnitarioSnapshot, subtotal: i.cantidad * i.precioUnitarioSnapshot, notas: i.notas })),
  };
}
