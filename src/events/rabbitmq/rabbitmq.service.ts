import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import * as amqp from 'amqplib';

import { ConfigService } from '@nestjs/config';

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: amqp.ChannelModel;

  private channel: amqp.Channel;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect() {
    try {
      const rabbitmqUrl = this.configService.get<string>(
        'RABBITMQ_URL',
        'amqp://admin:admin@localhost:5672',
      );
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();
      this.logger.log('Connected to RabbitMQ');

      //Event listener for monitoring connection
      this.connection.on('error', (err) => {
        this.logger.error('RabbitMQ connection error', err);
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
      });

      this.connection.on('blocked', (reason) => {
        this.logger.warn(`RabbitMQ connection blocked: ${reason}`);
      });

      this.connection.on('unblocked', () => {
        this.logger.log('RabbitMQ connection unblocked');
      });
    } catch (error) {
      this.logger.error(
        'Failed to connect to RabbitMQ, continuing without message queue',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        error.message || error,
      );
    }
  }

  private async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.logger.log('RabbitMQ channel closed');
      }

      if (this.connection) {
        await this.connection.close();
        this.logger.log('Disconnected from RabbitMQ');
      }
    } catch (error) {
      this.logger.error('Failed to disconnect from RabbitMQ', error);
    }
  }

  getChannel(): amqp.Channel {
    return this.channel;
  }

  getConnection(): amqp.ChannelModel {
    return this.connection;
  }

  async publishMessage(
    exchange: string,
    routingKey: string,
    message: any,
  ): Promise<void> {
    try {
      if (!this.channel) {
        this.logger.error('RabbitMQ channel is not initialized');
        return;
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const published = this.channel.publish(
        exchange,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          timestamp: Date.now(),
          contentType: 'application/json',
        },
      );

      if (!published) {
        throw new Error('Failed to publish message to RabbitMQ');
      }

      this.logger.log(
        `Message published to exchange "${exchange}" with routing key "${routingKey}"`,
      );
      this.logger.debug(`Message content: ${JSON.stringify(message)}`);
    } catch (error) {
      this.logger.error('Failed to publish message to RabbitMQ', error);
    }
  }
}
