import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsRepository } from './payments.repository.js';

@Module({ controllers: [PaymentsController], providers: [PaymentsService, PaymentsRepository], exports: [PaymentsService] })
export class PaymentsModule {}