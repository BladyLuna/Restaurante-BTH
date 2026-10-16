import { Controller, Get, Param, Inject } from '@nestjs/common';
import { Roles } from '../auth/auth.guard.js';
import { LocationsService, type LocationDto } from './locations.service.js';

@Controller('locations')
export class LocationsController {
  constructor(
    @Inject(LocationsService) private readonly locations: LocationsService,
  ) {}

  @Roles('ADMIN')
  @Get()
  async listar(): Promise<LocationDto[]> {
    return this.locations.listar();
  }

  @Roles('ADMIN')
  @Get(':id')
  async obtener(@Param('id') id: string): Promise<LocationDto> {
    return this.locations.obtener(id);
  }
}
