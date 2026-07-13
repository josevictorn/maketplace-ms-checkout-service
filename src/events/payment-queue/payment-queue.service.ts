import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { PaymentOrderMessage } from '../payment-queue.interface';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { MetricsService } from '../../metrics/metrics.service';

@Injectable()
export class PaymentQueueService {
  private readonly logger = new Logger(PaymentQueueService.name);

  private readonly ROUTING_KEY = 'payment.order';
  private readonly EXCHANGE = 'payments';

  constructor(
    private readonly rabbitMQService: RabbitmqService,
    private readonly metricsService: MetricsService,
  ) {}

  async publishPaymentOrder(paymentOrder: PaymentOrderMessage): Promise<void> {
    this.logger.log(
      `Publishing payment order for orderId: ${JSON.stringify(paymentOrder.orderId)}`,
    );

    try {
      const enrichmentMessage: PaymentOrderMessage = {
        ...paymentOrder,
        createdAt: paymentOrder.createdAt || new Date().toISOString(),
        metadata: {
          service: 'checkout-service',
          timestamp: new Date().toISOString(),
        },
      };

      await this.rabbitMQService.publishMessage(
        this.EXCHANGE, // Where to send the message
        this.ROUTING_KEY, // How to route the message
        enrichmentMessage, // what to send
      );

      this.metricsService.rabbitmqMessagesPublishedTotal.inc({
        queue: 'payment_order',
      });

      this.logger.log(
        `Payment order published successfully: ` +
          `orderId: ${enrichmentMessage.orderId}, ` +
          `userId: ${enrichmentMessage.userId}, ` +
          `amount: ${enrichmentMessage.amount}`,
      );

      this.logger.debug(
        `Payments order details: ${JSON.stringify(enrichmentMessage)}`,
      );
    } catch (error) {
      this.logger.error('Failed to publish payment order', error);
      throw error;
    }
  }

  private validatePaymentOrder(paymentOrder: PaymentOrderMessage): boolean {
    if (!paymentOrder.orderId) {
      this.logger.error('❌ Invalid payment order: missing orderId');

      return false;
    }

    if (!paymentOrder.userId) {
      this.logger.error('❌ Invalid payment order: missing userId');

      return false;
    }

    if (!paymentOrder.amount || paymentOrder.amount <= 0) {
      this.logger.error('❌ Invalid payment order: invalid amount');

      return false;
    }

    if (!paymentOrder.items || paymentOrder.items.length === 0) {
      this.logger.error('❌ Invalid payment order: no items');

      return false;
    }

    return true;
  }

  async publishPaymentOrderSafe(
    paymentOrder: PaymentOrderMessage,
  ): Promise<void> {
    if (!this.validatePaymentOrder(paymentOrder)) {
      throw new Error('Invalid payment order');
    }

    await this.publishPaymentOrder(paymentOrder);
  }
}
