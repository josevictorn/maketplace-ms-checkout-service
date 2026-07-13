import { Injectable } from '@nestjs/common';
import * as promClient from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly httpRequestsTotal: promClient.Counter<string>;
  private readonly httpRequestDurationSeconds: promClient.Histogram<string>;

  readonly ordersCreatedTotal: promClient.Counter<string>;
  readonly rabbitmqMessagesPublishedTotal: promClient.Counter<string>;

  constructor() {
    promClient.collectDefaultMetrics();

    this.httpRequestsTotal = new promClient.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    this.httpRequestDurationSeconds = new promClient.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.3, 0.5, 1, 1.5, 2, 5, 10],
    });

    this.ordersCreatedTotal = new promClient.Counter({
      name: 'orders_created_total',
      help: 'Total number of orders created',
    });

    this.rabbitmqMessagesPublishedTotal = new promClient.Counter({
      name: 'rabbitmq_messages_published_total',
      help: 'Total number of messages published to RabbitMQ',
      labelNames: ['queue'],
    });
  }

  getMetrics(): Promise<string> {
    return promClient.register.metrics();
  }

  incrementHttpRequestTotal(
    method: string,
    route: string,
    statusCode: number,
  ): void {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode });
  }

  observeHttpRequestDuration(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
  ): void {
    this.httpRequestDurationSeconds.observe(
      { method, route, status_code: statusCode },
      duration,
    );
  }
}
