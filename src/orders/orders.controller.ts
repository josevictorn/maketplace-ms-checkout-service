import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CheckoutDto } from '../cart/dto/checkout.dto';

interface AuthenticatedRequest {
  user: { id: string; email: string; role: string };
}

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('cart/checkout')
  async checkout(
    @Req() req: AuthenticatedRequest,
    @Body() checkoutDto: CheckoutDto,
  ) {
    const userId = req.user.id;
    return this.ordersService.checkout(userId, checkoutDto);
  }

  @Get('orders')
  async findAll(@Req() req: AuthenticatedRequest) {
    const userId = req.user.id;
    return this.ordersService.findAllByUser(userId);
  }

  @Get('orders/:id')
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const userId = req.user.id;
    return this.ordersService.findOneByUser(userId, id);
  }
}
