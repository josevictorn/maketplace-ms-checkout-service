import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { Request } from 'express';

interface RequestWithUser extends Request {
  user: {
    id: string;
  };
}

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@Req() req: RequestWithUser) {
    const userId = String(req.user.id);
    return this.cartService.getCart(userId);
  }

  @Post('items')
  async addItem(@Req() req: RequestWithUser, @Body() dto: AddCartItemDto) {
    const userId = String(req.user.id);
    return this.cartService.addItem(userId, dto);
  }

  @Delete('items/:itemId')
  async removeItem(
    @Req() req: RequestWithUser,
    @Param('itemId') itemId: string,
  ) {
    const userId = String(req.user.id);
    return this.cartService.removeItem(userId, itemId);
  }
}
