import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CatalogController } from './catalog.controller.js';
import { LocationsModule } from '../locations/locations.module.js';

@Module({
  imports: [LocationsModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  // orders (B7) consulta catalog directamente para el snapshot de precios.
  // Es una dependencia real del dominio, no acoplamiento accidental
  // (ARQUITECTURA §2, excepción pragmática).
  exports: [CatalogService],
})
export class CatalogModule {}
