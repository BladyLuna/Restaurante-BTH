import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { RateLimitService } from './rate-limit.service.js';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'desarrollo-cambiar-en-produccion',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RateLimitService, AuthGuard],
  exports: [AuthService, AuthGuard, RateLimitService],
})
export class AuthModule {}
