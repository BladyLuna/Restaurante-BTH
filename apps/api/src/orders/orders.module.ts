import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { LocationsModule } from '../locations/locations.module.js';

@Module({
  imports: [CatalogModule, LocationsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  // payments (B8) confirma pagos sobre pedidos existentes.
  exports: [OrdersService, OrdersRepository],
})
export class OrdersModule {}
