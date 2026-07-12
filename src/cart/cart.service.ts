import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartStatus } from './enums/cart-status.enum';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { ProductsClientService } from '../products-client/products-client.service';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    private readonly productsClientService: ProductsClientService,
  ) {}

  async getCart(
    userId: string,
  ): Promise<Cart | { items: any[]; total: number }> {
    const cart = await this.cartRepository.findOne({
      where: { userId, status: CartStatus.ACTIVE },
    });

    if (!cart) {
      return { items: [], total: 0 };
    }

    return cart;
  }

  async addItem(userId: string, dto: AddCartItemDto): Promise<Cart> {
    const product = await this.productsClientService.getProduct(dto.productId);

    if (!product.isActive) {
      throw new BadRequestException('Produto não está disponível');
    }

    let cart = await this.cartRepository.findOne({
      where: { userId, status: CartStatus.ACTIVE },
    });

    if (!cart) {
      cart = this.cartRepository.create({
        userId,
        status: CartStatus.ACTIVE,
        total: 0,
        items: [],
      });
      await this.cartRepository.save(cart);
    }

    let item = cart.items?.find((i) => i.productId === dto.productId);

    if (item) {
      item.quantity += dto.quantity;
      item.subtotal = Number((item.price * item.quantity).toFixed(2));
    } else {
      item = this.cartItemRepository.create({
        cartId: cart.id,
        productId: product.id,
        productName: product.name,
        price: product.price,
        quantity: dto.quantity,
        subtotal: Number((product.price * dto.quantity).toFixed(2)),
      });
      cart.items = cart.items ? [...cart.items, item] : [item];
    }

    cart.total = Number(
      cart.items
        .reduce((acc, curr) => acc + Number(curr.subtotal), 0)
        .toFixed(2),
    );

    await this.cartRepository.save(cart);
    return this.cartRepository.findOneOrFail({ where: { id: cart.id } });
  }

  async removeItem(userId: string, itemId: string): Promise<Cart> {
    const cart = await this.cartRepository.findOne({
      where: { userId, status: CartStatus.ACTIVE },
    });

    if (!cart) {
      throw new NotFoundException('Carrinho não encontrado');
    }

    const itemIndex = cart.items.findIndex((item) => item.id === itemId);

    if (itemIndex === -1) {
      throw new NotFoundException('Item não encontrado no carrinho');
    }

    const itemToRemove = cart.items[itemIndex];
    await this.cartItemRepository.remove(itemToRemove);

    cart.items.splice(itemIndex, 1);
    cart.total = Number(
      cart.items
        .reduce((acc, curr) => acc + Number(curr.subtotal), 0)
        .toFixed(2),
    );

    await this.cartRepository.save(cart);
    return this.cartRepository.findOneOrFail({ where: { id: cart.id } });
  }
}
