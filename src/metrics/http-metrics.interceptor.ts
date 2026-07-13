import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';
import { Request, Response } from 'express';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.recordMetrics(context, start),
        error: () => this.recordMetrics(context, start),
      }),
    );
  }

  private recordMetrics(context: ExecutionContext, start: number) {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const route = req.route ? req.route.path : req.path;

    if (route === '/metrics') {
      return;
    }

    const duration = (Date.now() - start) / 1000;
    const method = req.method;
    const statusCode = res.statusCode;

    this.metricsService.incrementHttpRequestTotal(method, route, statusCode);
    this.metricsService.observeHttpRequestDuration(
      method,
      route,
      statusCode,
      duration,
    );
  }
}
