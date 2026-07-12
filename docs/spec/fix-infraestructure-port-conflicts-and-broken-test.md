# SPEC: Correção de Conflitos de Porta e Teste Quebrado na Infraestrutura

**Autor:** Arquitetura  
**Data:** 2026-03-04  
**Status:** Draft  
**Serviços afetados:** `checkout-service`, `payments-service`

---

## 1. Contexto

O projeto **marketplace-ms** é composto por microserviços independentes, cada um com seu banco PostgreSQL próprio exposto em uma porta local distinta:

| Serviço            | Porta esperada | Porta atual (docker-compose) | Porta atual (.env) |
|--------------------|----------------|------------------------------|---------------------|
| users-service      | 5433           | 5433                         | 5433                |
| products-service   | 5434           | 5434                         | 5434                |
| checkout-service   | **5436**       | **5434** ❌                   | **5434** ❌          |
| payments-service   | 5435           | 5435                         | **5434** ❌          |

Foram identificados **três problemas** que impedem o funcionamento correto do ambiente de desenvolvimento:

### Problema 1 — Conflito de porta entre checkout-service e products-service

Ambos os serviços mapeiam a porta `5434` do host para o PostgreSQL interno. Isso impede a execução simultânea dos containers, pois o segundo a subir falha com `port already in use`.

### Problema 2 — Inconsistência de porta no payments-service

O `docker-compose.yaml` do `payments-service` expõe o banco na porta `5435`, porém o `.env` do mesmo serviço declara `DB_PORT=5434`. A aplicação, ao ler o `.env`, tenta conectar na porta errada.

### Problema 3 — Teste unitário quebrado no checkout-service

O `AppController` passou a depender de `PaymentQueueService` (injeção via construtor), mas o teste `app.controller.spec.ts` não registra esse provider no `TestingModule`, causando erro de resolução de dependência:

```
Nest can't resolve dependencies of the AppController (AppService, ?).
Please make sure that the argument PaymentQueueService at index [1] is available in the RootTestModule context.
```

---

## 2. Escopo

### Dentro do escopo

- Correção de portas no `checkout-service`
- Correção de porta no `payments-service`
- Correção do teste unitário do `checkout-service`

### Fora do escopo

- Qualquer alteração em `users-service` ou `products-service`
- Criação de `docker-compose` raiz ou `Dockerfile`s
- Alterações em lógica de negócio

---

## 3. Alterações Propostas

### 3.1 Correção do checkout-service — Porta do banco de dados

**Objetivo:** Alterar a porta do PostgreSQL do `checkout-service` de `5434` para `5436` em todos os pontos de configuração, eliminando o conflito com `products-service`.

#### 3.1.1 `checkout-service/docker-compose.yaml`

**Antes:**
```yaml
ports:
  - "5434:5432"
```

**Depois:**
```yaml
ports:
  - "5436:5432"
```

#### 3.1.2 `checkout-service/.env`

**Antes:**
```env
DB_PORT=5434
```

**Depois:**
```env
DB_PORT=5436
```

#### 3.1.3 `checkout-service/src/config/database.config.ts`

O fallback hardcoded deve refletir a nova porta para garantir consistência mesmo sem `.env`.

**Antes:**
```typescript
port: Number(process.env.DB_PORT) || 5434,
```

**Depois:**
```typescript
port: Number(process.env.DB_PORT) || 5436,
```

---

### 3.2 Correção do payments-service — Porta no .env

**Objetivo:** Alinhar o `DB_PORT` do `.env` com a porta real exposta pelo `docker-compose.yaml`.

#### 3.2.1 `payments-service/.env`

**Antes:**
```env
DB_PORT=5434
```

**Depois:**
```env
DB_PORT=5435
```

> O `docker-compose.yaml` do `payments-service` já expõe corretamente na porta `5435`. Nenhuma alteração é necessária nele.

---

### 3.3 Correção do teste unitário — checkout-service

**Objetivo:** Corrigir o `app.controller.spec.ts` adicionando um mock de `PaymentQueueService` ao `TestingModule`, permitindo que o `AppController` seja instanciado corretamente nos testes.

#### 3.3.1 `checkout-service/src/app.controller.spec.ts`

**Antes:**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
```

**Depois:**
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PaymentQueueService } from './events/payment-queue/payment-queue.service';

describe('AppController', () => {
  let appController: AppController;

  const mockPaymentQueueService = {
    publishPaymentOrder: jest.fn(),
    publishPaymentOrderSafe: jest.fn(),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PaymentQueueService,
          useValue: mockPaymentQueueService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
```

**Justificativa do mock:**
- `PaymentQueueService` depende de `RabbitmqService`, que por sua vez se conecta ao RabbitMQ. Nos testes unitários não é desejável iniciar conexões reais.
- O mock cobre os dois métodos públicos do serviço (`publishPaymentOrder` e `publishPaymentOrderSafe`), permitindo verificação de chamadas via `jest.fn()` se necessário no futuro.

---

## 4. Arquivos Modificados (Resumo)

| Arquivo                                              | Alteração                                |
|------------------------------------------------------|------------------------------------------|
| `checkout-service/docker-compose.yaml`               | Porta `5434` → `5436`                   |
| `checkout-service/.env`                              | `DB_PORT=5434` → `DB_PORT=5436`         |
| `checkout-service/src/config/database.config.ts`     | Fallback `5434` → `5436`                |
| `payments-service/.env`                              | `DB_PORT=5434` → `DB_PORT=5435`         |
| `checkout-service/src/app.controller.spec.ts`        | Adicionar mock de `PaymentQueueService`  |

**Total:** 5 arquivos · 0 arquivos novos · 0 arquivos removidos

---

## 5. Critérios de Aceite

### CA-1: Sem conflito de porta entre checkout-service e products-service
- [ ] O `docker-compose.yaml` do `checkout-service` expõe o PostgreSQL na porta `5436`
- [ ] O `.env` do `checkout-service` declara `DB_PORT=5436`
- [ ] O fallback em `database.config.ts` do `checkout-service` usa `5436`
- [ ] É possível executar `docker compose up` em `products-service` (porta 5434) e `checkout-service` (porta 5436) simultaneamente sem erro de porta

### CA-2: Porta consistente no payments-service
- [ ] O `.env` do `payments-service` declara `DB_PORT=5435`
- [ ] O `docker-compose.yaml` do `payments-service` continua expondo na porta `5435`
- [ ] O `payments-service` consegue conectar ao banco após `docker compose up`

### CA-3: Teste unitário do checkout-service passa
- [ ] O comando `npm run test -- app.controller.spec.ts` no `checkout-service` executa sem erros
- [ ] O `PaymentQueueService` é mockado corretamente (sem conexão real com RabbitMQ)
- [ ] O teste existente (`should return "Hello World!"`) continua passando

### CA-4: Nenhum efeito colateral
- [ ] Nenhum arquivo de `users-service` ou `products-service` foi alterado
- [ ] Nenhum `Dockerfile` ou `docker-compose` raiz foi criado
- [ ] A lógica de negócio de todos os serviços permanece inalterada

---

## 6. Mapa de Portas Final (Pós-correção)

| Serviço            | Porta App | Porta DB (host) |
|--------------------|-----------|------------------|
| users-service      | 3000      | 5433             |
| products-service   | 3001      | 5434             |
| checkout-service   | 3003      | **5436**         |
| payments-service   | 3004      | **5435**         |

---

## 7. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Desenvolvedor com volume antigo na porta 5434 para checkout-db | Conexão falha após a mudança | Documentar no PR que é necessário recriar o container: `docker compose down -v && docker compose up -d` |
| `.env` não commitado e desenvolvedor não atualiza localmente | App conecta na porta errada | Validar no `database.config.ts` com fallback correto (5436) e documentar no PR |

---

## 8. Plano de Execução

1. Alterar `checkout-service/docker-compose.yaml` (porta 5434 → 5436)
2. Alterar `checkout-service/.env` (DB_PORT=5434 → DB_PORT=5436)
3. Alterar `checkout-service/src/config/database.config.ts` (fallback 5434 → 5436)
4. Alterar `payments-service/.env` (DB_PORT=5434 → DB_PORT=5435)
5. Alterar `checkout-service/src/app.controller.spec.ts` (adicionar mock do PaymentQueueService)
6. Executar `npm run test` no `checkout-service` para validar CA-3
7. Subir ambos os bancos (`checkout-service` e `products-service`) para validar CA-1
8. Subir banco do `payments-service` para validar CA-2