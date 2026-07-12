# SPEC: Implementação do Gerenciamento de Carrinho

**Autor:** Arquitetura  
**Data:** 2026-03-04  
**Status:** Draft  
**Serviço afetado:** `checkout-service`

---

## 1. Contexto

O `checkout-service` (porta 3003) possui a infraestrutura completa para gerenciamento de carrinho: entidades `Cart` e `CartItem` com TypeORM, autenticação JWT com guard global e decorator `@Public()`, e as dependências `@nestjs/axios`, `axios`, `class-validator` e `class-transformer` já instaladas. A variável `PRODUCTS_SERVICE_URL` (`http://localhost:3001`) está configurada no `.env`.

Porém, o `CartModule` registra apenas as entidades — não possui controller, service, DTOs, nem comunicação com o `products-service`. Não existe nenhum endpoint funcional para manipulação do carrinho.

### Estado atual do CartModule

| Componente      | Status                  |
|-----------------|-------------------------|
| Entidades       | `Cart`, `CartItem` — implementadas e registradas no TypeORM |
| Controller      | Não existe              |
| Service         | Não existe              |
| DTOs            | Não existem             |
| Comunicação HTTP| Não existe (products-service não é consultado) |

### Referências do ecossistema

- O `products-service` (porta 3001) expõe `GET /products/:id` como rota pública (sem autenticação), retornando a entidade completa do produto: `id`, `name`, `description`, `price`, `stock`, `sellerId`, `isActive`, `createdAt`, `updatedAt`. Se o produto não existir, retorna `404 Not Found`.
- O endpoint **não** filtra por `isActive` — retorna qualquer produto pelo ID, incluindo inativos. A validação de produto ativo é responsabilidade do consumidor.

---

## 2. Escopo

### Dentro do escopo

- Criação de `ProductsClientModule` e `ProductsClientService` para comunicação HTTP com o `products-service`
- Criação de `CartService` com lógica de negócio do carrinho
- Criação de `CartController` com os endpoints de gerenciamento do carrinho
- Criação dos DTOs necessários com validação via `class-validator`
- Atualização do `CartModule` para registrar os novos componentes
- Atualização do `AppModule` se necessário

### Fora do escopo

- Checkout/finalização do carrinho (pedido) — será spec separada
- Alteração de quantidade de um item existente — simplificação: o usuário remove o item e adiciona novamente
- Verificação de estoque disponível (stock) — será validado no checkout
- Alterações no `products-service` ou em qualquer outro serviço
- Criação de testes unitários ou e2e (podem ser adicionados em spec futura)
- Alterações nas entidades `Cart`, `CartItem` ou `Order` existentes
- Alterações no `EventsModule` (RabbitMQ)

---

## 3. Requisitos Funcionais

### 3.1 ProductsClientModule / ProductsClientService

Módulo responsável por encapsular a comunicação HTTP com o `products-service`.

#### 3.1.1 Módulo

- Criar um módulo dedicado (`ProductsClientModule`) que importe o `HttpModule` do `@nestjs/axios`
- Configurar a `baseURL` do `HttpModule` usando `PRODUCTS_SERVICE_URL` do `ConfigService`
- Exportar o `ProductsClientService` para uso em outros módulos

#### 3.1.2 Service

- Método `getProduct(productId: string)` que realiza `GET /products/{productId}` no `products-service`
- Deve retornar os dados do produto necessários para o carrinho: `id`, `name`, `price`, `isActive`
- Em caso de produto não encontrado (404 do products-service), lançar exceção apropriada do NestJS (`NotFoundException`)
- Em caso de erro de comunicação (timeout, serviço indisponível), lançar exceção que indique falha na comunicação com serviço externo

### 3.2 POST /cart/items — Adicionar item ao carrinho

Endpoint protegido por JWT (comportamento padrão do guard global).

**Rota:** `POST /cart/items`

**Request body:**
| Campo       | Tipo   | Validação                                  |
|-------------|--------|--------------------------------------------|
| `productId` | string | UUID válido, obrigatório                   |
| `quantity`  | number | Inteiro, mínimo 1, obrigatório             |

**Fluxo:**
1. Obter o `userId` do token JWT (`req.user.id`)
2. Buscar o produto no `products-service` via `ProductsClientService.getProduct(productId)`
3. Validar que o produto existe e está ativo (`isActive: true`). Se inativo, retornar erro `400 Bad Request`
4. Buscar o carrinho ativo do usuário (status `active`). Se não existir, criar um novo
5. Verificar se já existe um `CartItem` com o mesmo `productId` no carrinho:
   - **Se existe:** somar a `quantity` recebida à quantidade existente e recalcular o `subtotal` (price × nova quantity total)
   - **Se não existe:** criar novo `CartItem` com `productName`, `price` (snapshot do momento), `quantity` e `subtotal` (price × quantity)
6. Recalcular o `total` do carrinho (soma de todos os `subtotal` dos itens)
7. Persistir as alterações

**Response (200):** O carrinho completo com seus itens e total atualizado.

**Erros:**
| Situação                              | HTTP Status | Mensagem                                 |
|---------------------------------------|-------------|------------------------------------------|
| Produto não encontrado                | 404         | Produto não encontrado                   |
| Produto inativo                       | 400         | Produto não está disponível              |
| Validação de body falhou              | 400         | Erros de validação do class-validator    |
| Falha na comunicação com products-service | 502     | Serviço de produtos indisponível         |

### 3.3 GET /cart — Ver carrinho do usuário

Endpoint protegido por JWT.

**Rota:** `GET /cart`

**Fluxo:**
1. Obter o `userId` do token JWT
2. Buscar o carrinho ativo do usuário (status `active`) com seus itens
3. Se não existir carrinho ativo, retornar uma representação de carrinho vazio (sem criar registro no banco)

**Response (200):** O carrinho com itens e total, ou representação de carrinho vazio.

**Formato do carrinho vazio:**
| Campo   | Valor      |
|---------|------------|
| `items` | `[]`       |
| `total` | `0`        |

### 3.4 DELETE /cart/items/:itemId — Remover item do carrinho

Endpoint protegido por JWT.

**Rota:** `DELETE /cart/items/:itemId`

**Parâmetro de rota:**
| Campo    | Tipo   | Validação          |
|----------|--------|--------------------|
| `itemId` | string | UUID válido        |

**Fluxo:**
1. Obter o `userId` do token JWT
2. Buscar o carrinho ativo do usuário
3. Verificar que o item (`itemId`) pertence ao carrinho do usuário. Se não pertencer ou não existir, retornar `404`
4. Remover o item do carrinho
5. Recalcular o `total` do carrinho (soma dos `subtotal` restantes, ou `0` se vazio)
6. Persistir as alterações

**Response (200):** O carrinho atualizado com itens restantes e total recalculado.

**Erros:**
| Situação                                  | HTTP Status | Mensagem                       |
|-------------------------------------------|-------------|--------------------------------|
| Carrinho ativo não encontrado             | 404         | Carrinho não encontrado        |
| Item não encontrado no carrinho do usuário| 404         | Item não encontrado no carrinho|

---

## 4. Regras de Negócio

| #   | Regra                                                                                      |
|-----|--------------------------------------------------------------------------------------------|
| RN1 | Cada usuário possui no máximo **1 carrinho com status `active`** por vez                  |
| RN2 | O preço (`price`) e o nome (`productName`) do produto são gravados no `CartItem` no momento da adição (snapshot). Alterações futuras no `products-service` não afetam itens já no carrinho |
| RN3 | O `subtotal` de cada item é calculado como `price × quantity`                             |
| RN4 | O `total` do carrinho é a soma de todos os `subtotal` de seus itens                       |
| RN5 | O usuário só pode manipular seu próprio carrinho — o `userId` é sempre extraído do token JWT, nunca do body ou query |
| RN6 | Tanto sellers quanto buyers podem ter carrinho (sem restrição de role)                     |
| RN7 | Ao adicionar um produto que já está no carrinho, a quantidade é **somada** (não substituída) e o subtotal recalculado |
| RN8 | Não existe endpoint para alterar quantidade — o fluxo é: remover item e adicionar novamente com a quantidade desejada |
| RN9 | Um produto inativo (`isActive: false`) não pode ser adicionado ao carrinho                 |

---

## 5. Estrutura de Arquivos (Pós-implementação)

```
src/
├── app.module.ts                              (modificado — import do ProductsClientModule se necessário)
├── cart/
│   ├── cart.module.ts                         (modificado — registrar controller, service e imports)
│   ├── cart.controller.ts                     (NOVO)
│   ├── cart.service.ts                        (NOVO)
│   ├── dto/
│   │   └── add-cart-item.dto.ts               (NOVO)
│   ├── entities/
│   │   ├── cart.entity.ts                     (inalterado)
│   │   └── cart-item.entity.ts                (inalterado)
│   └── enums/
│       └── cart-status.enum.ts                (inalterado)
├── products-client/
│   ├── products-client.module.ts              (NOVO)
│   └── products-client.service.ts             (NOVO)
├── auth/                                      (inalterado)
├── config/                                    (inalterado)
├── events/                                    (inalterado)
├── health/                                    (inalterado)
└── orders/                                    (inalterado)
```

**Total:** 4 arquivos novos · 2 arquivos modificados · 0 arquivos removidos

---

## 6. Dependências

| Pacote               | Status no `package.json` | Ação necessária |
|----------------------|--------------------------|-----------------|
| `@nestjs/axios`      | Já instalado             | Nenhuma         |
| `axios`              | Já instalado             | Nenhuma         |
| `class-validator`    | Já instalado             | Nenhuma         |
| `class-transformer`  | Já instalado             | Nenhuma         |

> Nenhuma dependência nova precisa ser instalada.

---

## 7. Variáveis de Ambiente

| Variável               | Valor atual no `.env`          | Ação necessária |
|------------------------|--------------------------------|-----------------|
| `PRODUCTS_SERVICE_URL` | `http://localhost:3001`        | Nenhuma — já configurado |

---

## 8. Critérios de Aceite

### CA-1: ProductsClientService funcional

- [ ] O `ProductsClientService` consegue buscar um produto existente por ID no `products-service`
- [ ] Retorna os dados do produto (ao menos `id`, `name`, `price`, `isActive`)
- [ ] Lança `NotFoundException` quando o `products-service` retorna 404
- [ ] Lança exceção apropriada quando o `products-service` está indisponível (timeout/erro de rede)
- [ ] A URL base é lida de `PRODUCTS_SERVICE_URL` via `ConfigService` (não hardcoded)

### CA-2: Adicionar item ao carrinho (POST /cart/items)

- [ ] Requisição sem token retorna `401 Unauthorized`
- [ ] Requisição com body inválido (productId não-UUID, quantity < 1, campos ausentes) retorna `400` com mensagens de validação
- [ ] Adicionar produto inexistente retorna `404`
- [ ] Adicionar produto inativo (`isActive: false`) retorna `400`
- [ ] Adicionar produto válido pela primeira vez cria o carrinho (se não existir) e o item, retornando o carrinho com total correto
- [ ] Adicionar o mesmo produto novamente soma a quantidade ao item existente e recalcula subtotal e total
- [ ] O `productName` e `price` salvos no `CartItem` são snapshot do momento da adição (vindos do `products-service`)
- [ ] O `subtotal` do item é igual a `price × quantity`
- [ ] O `total` do carrinho é a soma de todos os `subtotal`

### CA-3: Ver carrinho (GET /cart)

- [ ] Requisição sem token retorna `401 Unauthorized`
- [ ] Usuário com carrinho ativo recebe o carrinho com todos os itens e total
- [ ] Usuário sem carrinho ativo recebe representação de carrinho vazio (`items: []`, `total: 0`)
- [ ] O carrinho retornado pertence ao usuário autenticado (baseado no token JWT)

### CA-4: Remover item do carrinho (DELETE /cart/items/:itemId)

- [ ] Requisição sem token retorna `401 Unauthorized`
- [ ] Remover item com `itemId` inexistente retorna `404`
- [ ] Remover item que pertence a outro usuário retorna `404` (não revela existência)
- [ ] Remover item existente retorna o carrinho atualizado sem o item e com total recalculado
- [ ] Remover o último item do carrinho resulta em `total: 0` e `items: []`

### CA-5: Isolamento entre usuários

- [ ] Usuário A não consegue ver o carrinho do Usuário B
- [ ] Usuário A não consegue remover itens do carrinho do Usuário B
- [ ] O `userId` é sempre extraído do token JWT, não de parâmetros da requisição

### CA-6: Unicidade do carrinho ativo

- [ ] Um usuário nunca possui mais de um carrinho com status `active` simultaneamente
- [ ] Adicionar item quando já existe carrinho ativo reutiliza o carrinho existente
- [ ] Adicionar item quando não existe carrinho ativo cria um novo

### CA-7: Nenhum efeito colateral

- [ ] As entidades `Cart`, `CartItem` e `Order` permanecem inalteradas
- [ ] O `EventsModule` (RabbitMQ) permanece inalterado
- [ ] O `AuthModule` permanece inalterado
- [ ] Nenhum arquivo de outro serviço foi alterado
- [ ] O teste existente em `app.controller.spec.ts` continua passando

---

## 9. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| `products-service` fora do ar durante adição ao carrinho | Usuário não consegue adicionar itens | Retornar erro 502 com mensagem clara; o carrinho existente não é afetado |
| Preço do produto muda entre adição ao carrinho e checkout | Usuário paga preço diferente do atual | O preço é snapshot no momento da adição (RN2); a validação de preço no checkout será tratada em spec futura |
| Race condition: duas requisições simultâneas criam dois carrinhos ativos | Viola RN1 (unicidade de carrinho ativo) | Buscar carrinho existente antes de criar; em cenário de alta concorrência, considerar constraint UNIQUE parcial no banco (melhoria futura) |
| Cálculos com decimal e ponto flutuante | Totais com arredondamento incorreto | Utilizar operações que respeitem a precisão decimal (10,2) do banco |

---

## 10. Observações

- Esta spec **NÃO** inclui checkout/finalização de pedido — isso será tratado em spec subsequente.
- Não há endpoint para alterar quantidade de um item. O fluxo simplificado é: o usuário remove o item (`DELETE /cart/items/:itemId`) e adiciona novamente (`POST /cart/items`) com a quantidade desejada.
- O `ValidationPipe` global deve estar ativo no `main.ts` (com `whitelist: true` e `transform: true`) para que os DTOs com `class-validator` funcionem corretamente. Se ainda não estiver configurado, deve ser adicionado.
- O `CartController` deve usar o prefixo de rota `cart` (ex.: `@Controller('cart')`).