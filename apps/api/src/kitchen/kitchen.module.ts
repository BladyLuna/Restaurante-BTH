import { Module } from '@nestjs/common';
import { KitchenController } from './kitchen.controller.js';
import { KitchenService } from './kitchen.service.js';
@Module({ controllers: [KitchenController], providers: [KitchenService] })
export class KitchenModule {}
