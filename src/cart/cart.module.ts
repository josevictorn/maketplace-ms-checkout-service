import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { ProductsClientModule } from '../products-client/products-client.module';

@Module({
  imports: [TypeOrmModule.forFeature([Cart, CartItem]), ProductsClientModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [TypeOrmModule, CartService],
})
export class CartModule {}
