import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['credit_card', 'debit_card', 'pix', 'boleto'])
  paymentMethod: string;
}
