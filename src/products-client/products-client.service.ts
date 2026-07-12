import {
  Injectable,
  NotFoundException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';

export interface ProductResponse {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
}

@Injectable()
export class ProductsClientService {
  private readonly logger = new Logger(ProductsClientService.name);

  constructor(private readonly httpService: HttpService) {}

  async getProduct(productId: string): Promise<ProductResponse> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<ProductResponse>(`/products/${productId}`).pipe(
          catchError((error: AxiosError) => {
            if (error.response?.status === 404) {
              throw new NotFoundException('Produto não encontrado');
            }
            this.logger.error(
              `Error communicating with products-service: ${error.message}`,
            );
            throw new BadGatewayException('Serviço de produtos indisponível');
          }),
        ),
      );
      return data;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadGatewayException
      ) {
        throw error;
      }
      this.logger.error(`Unexpected error: ${error}`);
      throw new BadGatewayException('Serviço de produtos indisponível');
    }
  }
}
