import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { InfraModule } from './infra/infra.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { LocationsModule } from './locations/locations.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    InfraModule,
    AuthModule,
    LocationsModule,
    CatalogModule,
    OrdersModule,
  ],
  providers: [
    // AuthGuard global: todo endpoint exige sesión salvo los marcados
    // @Publico(). Es más seguro que lo inverso — olvidarse de poner el guard
    // en una ruta nueva la dejaría abierta.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
