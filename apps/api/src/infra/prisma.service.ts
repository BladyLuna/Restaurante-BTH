/**
 * Cliente Prisma como servicio de Nest.
 *
 * Fuente: ARQUITECTURA §2. Una sola instancia para toda la app: abrir un pool
 * por módulo agotaría las conexiones de Postgres.
 */

import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
