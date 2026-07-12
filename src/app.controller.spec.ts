import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PaymentQueueService } from './events/payment-queue/payment-queue.service';

describe('AppController', () => {
  let appController: AppController;

  const mockPaymentQueueService = {
    publishPaymentOrder: jest.fn(),
    publishPaymentOrderSafe: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PaymentQueueService,
          useValue: mockPaymentQueueService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
