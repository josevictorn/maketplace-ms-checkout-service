# SPEC: Implementação da Finalização de Pedido (Checkout)

**Autor:** Arquitetura  
**Data:** 2026-03-04  
**Status:** Draft  
**Serviço afetado:** `checkout-service`

---

## 1. Contexto

O `checkout-service` (porta 3003) já possui a infraestrutura completa para finalização de pedidos: entidades `Cart`, `CartItem` e `Order` com TypeORM, autenticação JWT com guard global, carrinho funcional (`POST /cart/items`, `GET /cart`, `DELETE /cart/items/:itemId`), e integração com RabbitMQ via `EventsModule` (`PaymentQueueService` com método `publishPaymentOrder`).

O `PaymentQueueService` publica mensagens no exchange `payments` com routing key `payment.order`. O `payments-service` consome essas mensagens da queue `payment_queue` e processa o pagamento de forma assíncrona.

Porém, o `OrdersModule` registra apenas a entidade `Order` — não possui controller, service, DTOs, nem integração com o `CartModule` ou `EventsModule`. Não existe nenhum endpoint funcional para finalização do carrinho ou consulta de pedidos.

### Estado atual do OrdersModule

| Componente | Status |
|------------|--------|
| Entidade `Order` | Implementada e registrada no TypeORM |
| Controller | Não existe |
| Service | Não existe |
| DTOs | Não existem |
| Integração com `CartModule` | Não existe |
| Integração com `EventsModule` | Não existe |

### Infraestrutura disponível

| Componente | Detalhes |
|------------|----------|
| `PaymentQueueService` | `publishPaymentOrder(message: PaymentOrderMessage): Promise<void>` — publica no exchange `payments`, routing key `payment.order` |
| `PaymentOrderMessage` | Interface com campos: `orderId`, `userId`, `amount`, `items[]`, `paymentMethod`, `createdAt?`, `metadata?` |
| `CartService` | Métodos `getCart(userId)`, `addItem(userId, dto)`, `removeItem(userId, itemId)` — método privado `getActiveCart(userId)` |
| `OrderStatus` enum | `PENDING`, `PAID`, `FAILED`, `CANCELLED` |
| `CartStatus` enum | `ACTIVE`, `COMPLETED`, `ABANDONED` |

---

## 2. Escopo

### Dentro do escopo

- Criação de `OrdersService` com lógica de negócio para finalizar carrinho e consultar pedidos
- Criação de `OrdersController` com os endpoints de checkout e consulta de pedidos
- Criação do DTO de checkout com validação via `class-validator`
- Atualização do `OrdersModule` para importar `CartModule` e `EventsModule`, e registrar controller e service
- Atualização do `CartModule` para exportar o `CartService`
- Atualização do `CartService` para expor funcionalidades necessárias ao checkout

### Fora do escopo

- Processamento de pagamento — é responsabilidade exclusiva do `payments-service`
- Cancelamento de pedido
- Verificação de estoque
- Atualização de status do pedido via callback do `payments-service` (será spec futura)
- Alterações nas entidades `Cart`, `CartItem` ou `Order` existentes
- Alterações no `EventsModule` (RabbitMQ) ou no `PaymentQueueService`
- Alterações no `products-service`, `payments-service` ou qualquer outro serviço
- Criação de testes unitários ou e2e (podem ser adicionados em spec futura)

---

## 3. Requisitos Funcionais

### 3.1 POST /cart/checkout — Finalizar carrinho

Endpoint protegido por JWT (comportamento padrão do guard global).

**Rota:** `POST /cart/checkout`

**Request body:**

| Campo           | Tipo   | Validação                                                                 |
|-----------------|--------|---------------------------------------------------------------------------|
| `paymentMethod` | string | Obrigatório, deve ser um dos valores: `credit_card`, `debit_card`, `pix`, `boleto` |

**Fluxo:**

1. Obter o `userId` do token JWT (`req.user.id`)
2. Buscar o carrinho ativo do usuário (status `active`) com seus itens
3. Validar que o carrinho existe e não está vazio (possui ao menos 1 item). Se não existir carrinho ativo ou estiver vazio, retornar erro apropriado
4. Criar um registro `Order` com:
   - `userId`: do token JWT
   - `cartId`: ID do carrinho ativo
   - `amount`: valor do `total` do carrinho
   - `paymentMethod`: recebido no body
   - `status`: `OrderStatus.PENDING`
5. Alterar o status do carrinho de `CartStatus.ACTIVE` para `CartStatus.COMPLETED`
6. Publicar mensagem no RabbitMQ via `PaymentQueueService.publishPaymentOrder()` com:
   - `orderId`: ID da order criada
   - `userId`: do token JWT
   - `amount`: total do carrinho
   - `items`: array mapeado a partir dos `CartItem` do carrinho, contendo `productId`, `quantity` e `price` de cada item
   - `paymentMethod`: recebido no body
7. Retornar a `Order` criada

**Response (201):** A Order criada com todos os seus campos (`id`, `userId`, `cartId`, `amount`, `status`, `paymentMethod`, `createdAt`, `updatedAt`).

**Erros:**

| Situação                                   | HTTP Status | Mensagem sugerida                    |
|--------------------------------------------|-------------|--------------------------------------|
| Carrinho ativo não encontrado              | 400         | Carrinho vazio ou não encontrado     |
| Carrinho ativo sem itens                   | 400         | Carrinho vazio ou não encontrado     |
| `paymentMethod` inválido ou ausente        | 400         | Erros de validação do class-validator|
| Token JWT ausente ou inválido              | 401         | Unauthorized                         |

### 3.2 GET /orders — Listar pedidos do usuário

Endpoint protegido por JWT.

**Rota:** `GET /orders`

**Fluxo:**

1. Obter o `userId` do token JWT
2. Buscar todos os pedidos (`Order`) do usuário
3. Ordenar por data de criação em ordem decrescente (mais recentes primeiro)

**Response (200):** Array de Orders do usuário ordenadas por `createdAt` decrescente. Se o usuário não possui pedidos, retorna array vazio `[]`.

### 3.3 GET /orders/:id — Detalhe do pedido

Endpoint protegido por JWT.

**Rota:** `GET /orders/:id`

**Parâmetro de rota:**

| Campo | Tipo   | Validação    |
|-------|--------|--------------|
| `id`  | string | UUID válido  |

**Fluxo:**

1. Obter o `userId` do token JWT
2. Buscar o pedido pelo `id` que pertença ao `userId` autenticado
3. Se o pedido não existir ou não pertencer ao usuário, retornar `404`

**Response (200):** A Order com todos os seus campos.

**Erros:**

| Situação                                             | HTTP Status | Mensagem sugerida          |
|------------------------------------------------------|-------------|----------------------------|
| Pedido não encontrado                                | 404         | Pedido não encontrado      |
| Pedido existe mas pertence a outro usuário           | 404         | Pedido não encontrado      |
| `id` não é UUID válido                               | 400         | Validation failed (uuid)   |
| Token JWT ausente ou inválido                        | 401         | Unauthorized               |

---

## 4. Regras de Negócio

| #   | Regra |
|-----|-------|
| RN1 | Só é possível finalizar um carrinho com status `active` e com pelo menos 1 item |
| RN2 | Ao finalizar, a `Order` é criada com `status: pending` — o pagamento é processado de forma assíncrona pelo `payments-service` |
| RN3 | Ao finalizar, o status do carrinho muda de `active` para `completed`, impossibilitando novas operações nesse carrinho |
| RN4 | O `amount` da `Order` é o `total` do carrinho no momento da finalização |
| RN5 | Os itens enviados na mensagem RabbitMQ refletem os `CartItem` do carrinho no momento da finalização (`productId`, `quantity`, `price`) |
| RN6 | Após a finalização, o usuário pode criar um novo carrinho (adicionando itens via `POST /cart/items`), pois o anterior está com status `completed` |
| RN7 | O `paymentMethod` aceita exclusivamente os valores: `credit_card`, `debit_card`, `pix`, `boleto` |
| RN8 | O usuário só pode visualizar seus próprios pedidos — o `userId` é sempre extraído do token JWT, nunca de parâmetros da requisição |
| RN9 | A consulta de um pedido que pertence a outro usuário retorna `404` (não revela a existência do pedido) |
| RN10 | A publicação da mensagem no RabbitMQ deve ocorrer após a persistência da `Order` e do status do carrinho. Se a publicação falhar, a order já estará criada com status `pending` (eventual consistency) |

---

## 5. Tipagem

Todas as funções, variáveis, parâmetros e retornos devem ser explicitamente tipados. Não utilizar `any`. Especificamente:

| Elemento | Requisito de tipagem |
|----------|---------------------|
| Parâmetros de métodos do service | Devem ter tipos explícitos (ex.: `userId: string`, `dto: CheckoutDto`) |
| Retorno de métodos do service | Devem declarar tipo de retorno explícito (ex.: `Promise<Order>`, `Promise<Order[]>`) |
| Parâmetros de métodos do controller | Devem ter tipos explícitos com decoradores apropriados |
| Request autenticado | Deve ser tipado com interface que declare a estrutura do `user` (ex.: `{ id: string; email: string; role: string }`) |
| DTO | Propriedades devem ter tipos explícitos com decoradores de validação |
| Variáveis locais | Devem ter tipos inferidos ou explícitos — nunca `any` |

---

## 6. Módulos e Dependências entre Módulos

### 6.1 Atualização do OrdersModule

O `OrdersModule` deve:

- Importar `TypeOrmModule.forFeature([Order])` (já existe)
- Importar `CartModule` para acessar o `CartService`
- Importar `EventsModule` para acessar o `PaymentQueueService`
- Declarar `OrdersController` como controller
- Declarar `OrdersService` como provider

### 6.2 Atualização do CartModule

O `CartModule` deve:

- Exportar o `CartService` para que o `OrdersModule` possa utilizá-lo
- Exportar o `TypeOrmModule` (Cart/CartItem) para que o `OrdersModule` possa acessar os repositórios se necessário

### 6.3 Rota do checkout no CartController vs OrdersController

O endpoint `POST /cart/checkout` deve pertencer ao `CartController` (prefixo `cart`), pois é uma ação sobre o carrinho. Porém, a lógica de criação da order está no `OrdersService`. O `CartController` deve injetar o `OrdersService` ou, alternativamente, o `OrdersController` pode expor a rota com path completo. A decisão de design fica a critério da implementação, desde que a rota final seja `POST /cart/checkout`.

---

## 7. Estrutura de Arquivos (Pós-implementação)

```
src/
├── app.module.ts                              (inalterado)
├── cart/
│   ├── cart.module.ts                         (modificado — exportar CartService e TypeOrmModule)
│   ├── cart.controller.ts                     (inalterado OU modificado se a rota checkout ficar aqui)
│   ├── cart.service.ts                        (modificado — expor método para obter carrinho ativo com itens e método para alterar status)
│   ├── dto/
│   │   ├── add-cart-item.dto.ts               (inalterado)
│   │   └── checkout.dto.ts                    (NOVO)
│   ├── entities/
│   │   ├── cart.entity.ts                     (inalterado)
│   │   └── cart-item.entity.ts                (inalterado)
│   └── enums/
│       └── cart-status.enum.ts                (inalterado)
├── orders/
│   ├── orders.module.ts                       (modificado — imports, controller, providers)
│   ├── orders.controller.ts                   (NOVO)
│   └── orders.service.ts                      (NOVO)
├── events/                                    (inalterado)
├── auth/                                      (inalterado)
├── config/                                    (inalterado)
├── health/                                    (inalterado)
└── products-client/                           (inalterado)
```

**Total:** 3 arquivos novos · 3 arquivos modificados · 0 arquivos removidos

---

## 8. Dependências

| Pacote             | Status no `package.json` | Ação necessária |
|--------------------|--------------------------|-----------------|
| `class-validator`  | Já instalado             | Nenhuma         |
| `class-transformer`| Já instalado             | Nenhuma         |
| `typeorm`          | Já instalado             | Nenhuma         |
| `@nestjs/typeorm`  | Já instalado             | Nenhuma         |

> Nenhuma dependência nova precisa ser instalada.

---

## 9. Critérios de Aceite

### CA-1: Finalização do carrinho (POST /cart/checkout)

- [ ] Requisição sem token retorna `401 Unauthorized`
- [ ] Requisição com `paymentMethod` ausente retorna `400` com mensagem de validação
- [ ] Requisição com `paymentMethod` inválido (ex.: `"bitcoin"`) retorna `400` com mensagem de validação
- [ ] Requisição com carrinho ativo vazio (sem itens) retorna `400`
- [ ] Requisição sem carrinho ativo retorna `400`
- [ ] Requisição válida com carrinho contendo itens retorna `201` com a Order criada
- [ ] A Order criada possui `status: "pending"`, `amount` igual ao total do carrinho, `paymentMethod` conforme enviado, `userId` do token e `cartId` do carrinho
- [ ] Após a finalização, o status do carrinho é alterado para `completed`
- [ ] Após a finalização, `GET /cart` retorna carrinho vazio (pois o anterior está `completed`)
- [ ] Uma mensagem `PaymentOrderMessage` é publicada no RabbitMQ com `orderId`, `userId`, `amount`, `items` (com `productId`, `quantity`, `price` de cada item) e `paymentMethod`
- [ ] Tentativa de finalizar novamente (sem itens no carrinho ativo) retorna `400`

### CA-2: Listagem de pedidos (GET /orders)

- [ ] Requisição sem token retorna `401 Unauthorized`
- [ ] Usuário sem pedidos recebe array vazio `[]`
- [ ] Usuário com pedidos recebe array de Orders ordenado por `createdAt` decrescente
- [ ] Apenas pedidos do usuário autenticado são retornados
- [ ] Cada Order no array contém todos os campos da entidade (`id`, `userId`, `cartId`, `amount`, `status`, `paymentMethod`, `createdAt`, `updatedAt`)

### CA-3: Detalhe do pedido (GET /orders/:id)

- [ ] Requisição sem token retorna `401 Unauthorized`
- [ ] Requisição com `id` não-UUID retorna `400`
- [ ] Requisição com `id` de pedido inexistente retorna `404`
- [ ] Requisição com `id` de pedido pertencente a outro usuário retorna `404` (não revela existência)
- [ ] Requisição com `id` de pedido válido do próprio usuário retorna `200` com a Order completa

### CA-4: Integridade do fluxo completo

- [ ] Fluxo completo funciona: adicionar itens ao carrinho → finalizar checkout → pedido aparece em `GET /orders` → pedido visível em `GET /orders/:id`
- [ ] Após finalizar o checkout, é possível criar um novo carrinho adicionando itens (o anterior está `completed`)
- [ ] O novo carrinho é independente do anterior

### CA-5: Tipagem

- [ ] Todas as funções possuem tipo de retorno explícito
- [ ] Todos os parâmetros de funções possuem tipo explícito
- [ ] Nenhum uso de `any` no código novo
- [ ] O DTO possui decoradores de validação com tipos explícitos
- [ ] Requests autenticados utilizam interface tipada para o objeto `user`

### CA-6: Nenhum efeito colateral

- [ ] As entidades `Cart`, `CartItem` e `Order` permanecem inalteradas
- [ ] O `EventsModule`, `PaymentQueueService` e `RabbitmqService` permanecem inalterados
- [ ] A interface `PaymentOrderMessage` permanece inalterada
- [ ] O `AuthModule` permanece inalterado
- [ ] Nenhum arquivo de outro serviço foi alterado
- [ ] Os endpoints existentes do carrinho (`POST /cart/items`, `GET /cart`, `DELETE /cart/items/:itemId`) continuam funcionando normalmente
- [ ] O endpoint de health (`GET /health`) continua funcionando

---

## 10. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| RabbitMQ fora do ar no momento do checkout | Mensagem não é publicada, `payments-service` não processa o pagamento | A Order é criada com status `pending` antes da publicação. O `RabbitmqService` já trata graciosamente a ausência de channel. Um mecanismo de retry/reconciliação pode ser adicionado em spec futura |
| Falha entre criação da Order e atualização do status do carrinho | Inconsistência: Order criada mas carrinho ainda `active` | Realizar as operações de persistência (Order + status do carrinho) na mesma transação quando possível, ou garantir a ordem correta das operações |
| Usuário envia múltiplas requisições simultâneas de checkout | Possibilidade de criar múltiplas Orders para o mesmo carrinho | Após criar a Order, o status do carrinho muda para `completed`. A validação inicial verifica carrinho `active`, reduzindo a janela de race condition. Para robustez adicional, considerar lock otimista ou constraint UNIQUE em spec futura |
| Valores decimais com arredondamento incorreto | Divergência entre `amount` da Order e `total` do carrinho | Utilizar o `total` já calculado e persistido no carrinho, que respeita a precisão decimal (10,2) do banco |

---

## 11. Observações

- Esta spec **NÃO** inclui processamento de pagamento — isso é responsabilidade exclusiva do `payments-service`.
- Esta spec **NÃO** inclui cancelamento de pedido ou verificação de estoque.
- O status da Order permanecerá `pending` até que o `payments-service` processe o pagamento e comunique o resultado (mecanismo a ser definido em spec futura).
- O `CartService` atualmente possui o método `getActiveCart` como `private`. Será necessário expor funcionalidades equivalentes (busca de carrinho ativo com itens e atualização de status) como métodos públicos para uso pelo `OrdersService`.
- O `ValidationPipe` global já está ativo no `main.ts` com `whitelist: true`, `forbidNonWhitelisted: true` e `transform: true`.