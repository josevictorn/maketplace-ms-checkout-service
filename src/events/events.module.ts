import { Module } from '@nestjs/common';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [RabbitmqService],
  exports: [RabbitmqService],
})
export class EventsModule {}
