import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { RabbitmqService } from '../../events/rabbitmq/rabbitmq.service';
import { OrdersService } from '../orders.service';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentResultMessage } from '../../events/payment-result.interface';

@Injectable()
export class PaymentResultConsumerService implements OnModuleInit {
  private readonly logger = new Logger(PaymentResultConsumerService.name);

  private readonly queue = 'payment_result_queue';
  private readonly exchange = 'payments';
  private readonly routingKey = 'payment.result';

  private readonly statusMap: Record<
    PaymentResultMessage['status'],
    OrderStatus
  > = {
    approved: OrderStatus.PAID,
    rejected: OrderStatus.FAILED,
  };

  constructor(
    private readonly rabbitmqService: RabbitmqService,
    private readonly ordersService: OrdersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitmqService.subscribeToQueue(
      this.queue,
      this.exchange,
      this.routingKey,
      this.handleMessage.bind(this),
    );

    this.logger.log(
      `Subscribed to queue ${this.queue} (${this.exchange}/${this.routingKey})`,
    );
  }

  private async handleMessage(message: unknown): Promise<void> {
    const payload = message as PaymentResultMessage;

    if (!payload.orderId || !payload.status) {
      this.logger.warn(
        `Invalid payment result message received: ${JSON.stringify(message)}`,
      );
      return;
    }

    const newStatus = this.statusMap[payload.status];

    if (!newStatus) {
      this.logger.warn(
        `Unknown payment status "${payload.status}" for orderId=${payload.orderId}`,
      );
      return;
    }

    try {
      const order = await this.ordersService.updateOrderStatus(
        payload.orderId,
        newStatus,
      );

      this.logger.log(
        `Order ${payload.orderId} updated: ${payload.status} -> ${order.status}`,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        this.logger.warn(
          `Order ${payload.orderId} not found, acknowledging message`,
        );
        return;
      }

      this.logger.error(`Failed to update order ${payload.orderId}: ${error}`);
      throw error;
    }
  }
}
