# SPEC: Criação das Entidades de Domínio e Configuração de Autenticação JWT

**Autor:** Arquitetura  
**Data:** 2026-03-04  
**Status:** Draft  
**Serviço afetado:** `checkout-service`

---

## 1. Contexto

O `checkout-service` (porta 3003) possui o scaffold NestJS funcional com PostgreSQL (porta 5436), TypeORM configurado e integração com RabbitMQ via `EventsModule`/`PaymentQueueService`. Porém, o serviço apresenta duas lacunas críticas:

1. **Sem entidades de domínio** — O TypeORM está configurado com autoload de entidades (`**/*.entity{.ts,.js}`), mas nenhuma entidade existe. O banco `checkout_db` não possui tabelas.
2. **Sem autenticação JWT** — As dependências `@nestjs/jwt`, `@nestjs/passport`, `passport` e `passport-jwt` já estão no `package.json`, mas nenhum módulo de autenticação foi implementado. Qualquer rota está acessível sem token.

### Referências do ecossistema

- O `users-service` (porta 3000) é a autoridade de autenticação e gera tokens JWT com payload `{ sub: UUID, email: string, role: "seller"|"buyer" }`, assinados com `JWT_SECRET` e expiração de 24h.
- O `products-service` (porta 3001) já implementou a validação JWT seguindo o padrão: `AuthModule` com `JwtStrategy`, `JwtAuthGuard` global via `APP_GUARD`, e decorator `@Public()` para rotas abertas.
- O `checkout-service` já possui `JWT_SECRET` configurado no `.env` com o mesmo valor dos demais serviços.

---

## 2. Escopo

### Dentro do escopo

- Criação das entidades `Cart`, `CartItem` e `Order` com TypeORM
- Criação dos módulos `CartModule` e `OrdersModule` (apenas registro de entidades, sem controllers/services CRUD)
- Criação do `AuthModule` com validação JWT (mesmo padrão do `products-service`)
- Health check público (`GET /health`)
- Configuração do Swagger no `main.ts`
- Atualização do `AppModule` para registrar todos os novos módulos

### Fora do escopo

- Endpoints CRUD para Cart, CartItem ou Order (specs futuras)
- Lógica de negócio (cálculo de totais, fluxo de checkout, etc.)
- Alterações no `EventsModule` existente (RabbitMQ)
- Alterações em outros serviços (`users-service`, `products-service`, `payments-service`)
- Criação de DTOs ou pipes de validação específicos
- Seeds ou migrations manuais (TypeORM `synchronize: true` criará as tabelas)

---

## 3. Alterações Propostas

### 3.1 Entidade Cart

**Arquivo:** `checkout-service/src/cart/entities/cart.entity.ts`

Representação do carrinho de compras de um usuário.

| Coluna      | Tipo                         | Restrições / Padrão                        |
|-------------|------------------------------|--------------------------------------------|
| `id`        | UUID                         | PK, gerado automaticamente                 |
| `userId`    | UUID                         | Obrigatório                                |
| `status`    | enum: `active`, `completed`, `abandoned` | Default: `active`              |
| `total`     | decimal(10,2)                | Default: `0`                               |
| `items`     | OneToMany → `CartItem`       | Cascade: true, Eager: true                 |
| `createdAt` | timestamp                    | Gerado automaticamente (CreateDateColumn)  |
| `updatedAt` | timestamp                    | Gerado automaticamente (UpdateDateColumn)  |

O enum de status deve ser definido em arquivo separado: `checkout-service/src/cart/enums/cart-status.enum.ts`

### 3.2 Entidade CartItem

**Arquivo:** `checkout-service/src/cart/entities/cart-item.entity.ts`

Item individual dentro de um carrinho.

| Coluna        | Tipo            | Restrições / Padrão                          |
|---------------|-----------------|----------------------------------------------|
| `id`          | UUID            | PK, gerado automaticamente                   |
| `cart`        | ManyToOne → `Cart` | onDelete: CASCADE                          |
| `cartId`      | UUID            | FK para Cart (coluna explícita)               |
| `productId`   | UUID            | Obrigatório                                   |
| `productName` | varchar(255)    | Obrigatório                                   |
| `price`       | decimal(10,2)   | Obrigatório                                   |
| `quantity`    | int             | Default: `1`                                  |
| `subtotal`    | decimal(10,2)   | Obrigatório                                   |
| `createdAt`   | timestamp       | Gerado automaticamente (CreateDateColumn)     |

### 3.3 Entidade Order

**Arquivo:** `checkout-service/src/orders/entities/order.entity.ts`

Registro de um pedido gerado a partir de um carrinho finalizado.

| Coluna          | Tipo                                    | Restrições / Padrão                       |
|-----------------|-----------------------------------------|-------------------------------------------|
| `id`            | UUID                                    | PK, gerado automaticamente                |
| `userId`        | UUID                                    | Obrigatório                               |
| `cartId`        | UUID                                    | Obrigatório                               |
| `amount`        | decimal(10,2)                           | Obrigatório                               |
| `status`        | enum: `pending`, `paid`, `failed`, `cancelled` | Default: `pending`                 |
| `paymentMethod` | varchar(50)                             | Obrigatório                               |
| `createdAt`     | timestamp                               | Gerado automaticamente (CreateDateColumn) |
| `updatedAt`     | timestamp                               | Gerado automaticamente (UpdateDateColumn) |

O enum de status deve ser definido em arquivo separado: `checkout-service/src/orders/enums/order-status.enum.ts`

### 3.3.1 Compatibilidade com PaymentOrderMessage

As entidades foram desenhadas para alimentar diretamente a interface `PaymentOrderMessage` (usada pelo `EventsModule` para publicar no RabbitMQ). Os nomes dos campos da entidade `Order` são idênticos aos da mensagem, eliminando a necessidade de mapeamento:

| Campo da mensagem   | Origem                | Mapeamento |
|---------------------|-----------------------|------------|
| `orderId`           | `Order.id`            | Direto     |
| `userId`            | `Order.userId`        | Direto     |
| `amount`            | `Order.amount`        | Direto     |
| `paymentMethod`     | `Order.paymentMethod` | Direto     |
| `createdAt`         | `Order.createdAt`     | Direto     |
| `items[].productId` | `CartItem.productId`  | Direto     |
| `items[].quantity`  | `CartItem.quantity`   | Direto     |
| `items[].price`     | `CartItem.price`      | Direto     |
| `metadata`          | —                     | Enriquecido automaticamente pelo `PaymentQueueService` |

> O campo `description` foi removido da interface `PaymentOrderMessage` (checkout-service e payments-service) por não ter origem nas entidades de domínio e não ser validado pelo consumer.

**Campos exclusivos das entidades** — `CartItem.productName` e `CartItem.subtotal` existem nas entidades mas **não** na mensagem de pagamento. Isso é intencional: esses campos servem ao domínio do checkout (exibição e histórico) e não são necessários para o processamento de pagamento.

### 3.4 CartModule

**Arquivo:** `checkout-service/src/cart/cart.module.ts`

- Importar `TypeOrmModule.forFeature([Cart, CartItem])`
- Neste momento, apenas registra as entidades — sem controllers ou services

### 3.5 OrdersModule

**Arquivo:** `checkout-service/src/orders/orders.module.ts`

- Importar `TypeOrmModule.forFeature([Order])`
- Neste momento, apenas registra a entidade — sem controllers ou services

### 3.6 AuthModule (JWT)

Replicar o padrão já estabelecido no `products-service`. Estrutura de arquivos:

```
src/auth/
├── auth.module.ts
├── strategies/
│   └── jwt.strategy.ts
├── guards/
│   └── jwt-auth.guard.ts
└── decorators/
    └── public.decorator.ts
```

#### 3.6.1 AuthModule (`src/auth/auth.module.ts`)

- Importar `PassportModule` e `JwtModule.registerAsync` (lendo `JWT_SECRET` do `ConfigService`)
- Registrar `JwtStrategy` como provider
- Registrar `JwtAuthGuard` como guard global via `APP_GUARD`

#### 3.6.2 JwtStrategy (`src/auth/strategies/jwt.strategy.ts`)

- Extender `PassportStrategy(Strategy)` do `passport-jwt`
- Extrair token do header `Authorization: Bearer <token>`
- Validar com `JWT_SECRET` obtido via `ConfigService`
- Não ignorar expiração (`ignoreExpiration: false`)
- No método `validate`, mapear o payload `{ sub, email, role }` para `{ id, email, role }` (anexado a `req.user`)

#### 3.6.3 JwtAuthGuard (`src/auth/guards/jwt-auth.guard.ts`)

- Extender `AuthGuard('jwt')`
- Usar `Reflector` para verificar metadata `IS_PUBLIC_KEY`
- Se a rota for pública, retornar `true` (bypass do JWT)
- Caso contrário, delegar para `super.canActivate()`

#### 3.6.4 Decorator @Public (`src/auth/decorators/public.decorator.ts`)

- Exportar constante `IS_PUBLIC_KEY`
- Exportar decorator `Public()` que usa `SetMetadata` para marcar rotas como públicas

### 3.7 Health Check

**Arquivo:** `checkout-service/src/health/health.controller.ts`

- Endpoint `GET /health` decorado com `@Public()`
- Retornar `{ status: "ok", service: "checkout-service" }`

### 3.8 Swagger

**Arquivo:** `checkout-service/src/main.ts`

- Adicionar `@nestjs/swagger` como dependência do projeto
- Configurar `DocumentBuilder` com título "Checkout Service", versão "1.0" e suporte a `BearerAuth`
- Montar documentação na rota `/api`

### 3.9 Atualização do AppModule

**Arquivo:** `checkout-service/src/app.module.ts`

Registrar no array de imports (mantendo os existentes):

- `AuthModule`
- `CartModule`
- `OrdersModule`

Registrar no array de controllers:

- `HealthController`

> O `EventsModule` existente **NÃO** deve ser alterado.

---

## 4. Estrutura de Arquivos (Pós-implementação)

```
src/
├── main.ts                          (modificado — Swagger)
├── app.module.ts                    (modificado — novos imports)
├── app.controller.ts                (inalterado)
├── app.service.ts                   (inalterado)
├── config/
│   └── database.config.ts           (inalterado)
├── events/                          (inalterado)
│   ├── events.module.ts
│   ├── payment-queue.interface.ts
│   ├── payment-queue/
│   │   └── payment-queue.service.ts
│   └── rabbitmq/
│       └── rabbitmq.service.ts
├── auth/                            (NOVO)
│   ├── auth.module.ts
│   ├── strategies/
│   │   └── jwt.strategy.ts
│   ├── guards/
│   │   └── jwt-auth.guard.ts
│   └── decorators/
│       └── public.decorator.ts
├── cart/                            (NOVO)
│   ├── cart.module.ts
│   ├── entities/
│   │   ├── cart.entity.ts
│   │   └── cart-item.entity.ts
│   └── enums/
│       └── cart-status.enum.ts
├── orders/                          (NOVO)
│   ├── orders.module.ts
│   ├── entities/
│   │   └── order.entity.ts
│   └── enums/
│       └── order-status.enum.ts
└── health/                          (NOVO)
    └── health.controller.ts
```

**Total:** 12 arquivos novos · 2 arquivos modificados · 0 arquivos removidos

---

## 5. Dependências

| Pacote             | Status no `package.json` | Ação necessária        |
|--------------------|--------------------------|------------------------|
| `@nestjs/jwt`      | Já instalado             | Nenhuma                |
| `@nestjs/passport` | Já instalado             | Nenhuma                |
| `passport`         | Já instalado             | Nenhuma                |
| `passport-jwt`     | Já instalado             | Nenhuma                |
| `@nestjs/swagger`  | **Não instalado**        | Instalar               |

---

## 6. Variáveis de Ambiente

| Variável       | Valor atual no `.env`       | Ação necessária |
|----------------|-----------------------------|-----------------|
| `JWT_SECRET`   | Presente (já configurado)   | Nenhuma — garantir que o valor seja idêntico ao do `users-service` em ambiente de desenvolvimento |
| `JWT_EXPIRES_IN` | Presente (já configurado) | Nenhuma (não é utilizado na validação, apenas na emissão pelo `users-service`) |

> **Importante:** A variável `JWT_SECRET` do `checkout-service` **deve** ter o mesmo valor que a do `users-service`, pois o `checkout-service` apenas valida tokens — não os emite.

---

## 7. Critérios de Aceite

### CA-1: Tabelas criadas no banco de dados

- [ ] Ao iniciar o `checkout-service` com o banco PostgreSQL rodando, o TypeORM cria automaticamente as tabelas `cart`, `cart_item` e `order`
- [ ] A tabela `cart` possui as colunas: `id` (UUID PK), `userId` (UUID), `status` (enum), `total` (decimal), `createdAt`, `updatedAt`
- [ ] A tabela `cart_item` possui as colunas: `id` (UUID PK), `cartId` (UUID FK), `productId` (UUID), `productName` (varchar 255), `price` (decimal), `quantity` (int), `subtotal` (decimal), `createdAt`
- [ ] A tabela `order` possui as colunas: `id` (UUID PK), `userId` (UUID), `cartId` (UUID), `amount` (decimal), `status` (enum), `paymentMethod` (varchar 50), `createdAt`, `updatedAt`
- [ ] O relacionamento Cart → CartItem funciona com cascade e eager loading
- [ ] Deletar um Cart remove seus CartItems em cascata (onDelete CASCADE)

### CA-2: Autenticação JWT funcional

- [ ] Requisições sem token para rotas não-públicas retornam `401 Unauthorized`
- [ ] Requisições com token inválido retornam `401 Unauthorized`
- [ ] Requisições com token expirado retornam `401 Unauthorized`
- [ ] Requisições com token válido (gerado pelo `users-service`) são aceitas, e `req.user` contém `{ id, email, role }`
- [ ] O `JWT_SECRET` utilizado é lido da variável de ambiente (não hardcoded)

### CA-3: Rotas públicas acessíveis sem token

- [ ] `GET /health` retorna `{ status: "ok", service: "checkout-service" }` sem necessidade de token
- [ ] O Swagger UI está acessível em `GET /api` sem necessidade de token

### CA-4: Swagger operacional

- [ ] O Swagger está disponível em `/api` e exibe a documentação da API
- [ ] O Swagger possui suporte a BearerAuth para teste de rotas protegidas

### CA-5: Aplicação inicializa sem erros

- [ ] O comando `npm run start:dev` no `checkout-service` inicia sem erros
- [ ] O console exibe a mensagem de inicialização na porta 3003
- [ ] Nenhum erro de resolução de dependências do NestJS aparece nos logs

### CA-6: EventsModule inalterado

- [ ] O `EventsModule`, `PaymentQueueService` e `RabbitmqService` permanecem inalterados
- [ ] A funcionalidade de publicação de mensagens no RabbitMQ continua funcionando

### CA-7: Teste existente continua passando

- [ ] O comando `npm run test` no `checkout-service` executa sem falhas
- [ ] O teste em `app.controller.spec.ts` continua passando

---

## 8. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| `JWT_SECRET` diferente entre serviços | Tokens gerados pelo `users-service` serão rejeitados pelo `checkout-service` | Documentar que o valor deve ser idêntico; validar no PR que o `.env` usa o mesmo valor |
| `synchronize: true` em produção pode causar perda de dados | Alterações nas entidades podem dropar/recriar tabelas | Garantir que `synchronize` esteja condicionado ao `NODE_ENV`; migrar para migrations antes do deploy em produção |
| Swagger exposto em produção | Superfície de ataque desnecessária | Considerar condicionar a configuração do Swagger ao `NODE_ENV !== 'production'` em spec futura |

---

## 9. Observações

- Esta spec **NÃO** inclui endpoints CRUD. Os controllers e services de Cart e Orders serão definidos em specs subsequentes.
- O `AppController` existente com as rotas `GET /` e `POST /test/send-message` deve ser tratado: a rota `GET /` pode ser marcada com `@Public()` ou removida em favor do health check. A rota de teste do RabbitMQ deve ser avaliada se será mantida (recomendação: marcar como `@Public()` temporariamente para não quebrar funcionalidade existente durante desenvolvimento).