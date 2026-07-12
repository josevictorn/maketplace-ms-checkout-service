export interface PaymentOrderMessage {
  orderId: string;
  userId: string;
  amount: number;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  paymentMethod: string;
  createdAt?: string;
  metadata?: {
    service: string;
    timestamp: string;
  };
}
