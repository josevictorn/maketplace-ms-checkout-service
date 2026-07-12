import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';
import { CartService } from '../cart/cart.service';
import { PaymentQueueService } from '../events/payment-queue/payment-queue.service';
import { CartStatus } from '../cart/enums/cart-status.enum';
import { CheckoutDto } from '../cart/dto/checkout.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly cartService: CartService,
    private readonly paymentQueueService: PaymentQueueService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto): Promise<Order> {
    const cart = await this.cartService.getActiveCartWithItems(userId);

    const order = this.orderRepository.create({
      userId,
      cartId: cart.id,
      amount: cart.total,
      paymentMethod: dto.paymentMethod,
      status: OrderStatus.PENDING,
    });

    const savedOrder = await this.orderRepository.save(order);

    await this.cartService.updateCartStatus(cart.id, CartStatus.COMPLETED);

    const items = cart.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    }));

    // Publica no RabbitMQ (mesmo se falhar, a order e o carrinho já foram atualizados)
    try {
      await this.paymentQueueService.publishPaymentOrderSafe({
        orderId: savedOrder.id,
        userId: savedOrder.userId,
        amount: savedOrder.amount,
        items,
        paymentMethod: savedOrder.paymentMethod,
      });
    } catch (error) {
      console.error('Failed to publish payment order after checkout', error);
      // Eventual consistency: the order is created, but the message might need to be retried later.
    }

    return savedOrder;
  }

  async findAllByUser(userId: string): Promise<Order[]> {
    return this.orderRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOneByUser(userId: string, orderId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Pedido não encontrado');
    }

    return order;
  }
}
