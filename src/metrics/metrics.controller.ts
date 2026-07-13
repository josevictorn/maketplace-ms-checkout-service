import { Controller, Get, Header } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { register } from 'prom-client';
import { Public } from '../auth/decorators/public.decorator';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Public()
  @Get()
  @Header('Content-Type', register.contentType)
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
