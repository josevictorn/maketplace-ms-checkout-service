# SPEC: Instrumentação de Métricas HTTP com Prometheus (Checkout Service)

## Contexto
O serviço `checkout-service` precisa expor um endpoint `GET /metrics` contendo métricas no formato do Prometheus. Atualmente, o Prometheus já está configurado na `observability-stack` para consultar esta rota a cada 15 segundos, mas o target está "down".

Esta spec define a criação de um módulo global de métricas usando a biblioteca `prom-client` para expor métricas padrão do Node.js e métricas HTTP customizadas (contador de requisições e histograma de duração).

## 1. Dependências
Instalar a biblioteca oficial do Prometheus para Node.js:
```bash
npm install prom-client
```

## 2. Implementação do MetricsModule

Criar um módulo global `@Global()` chamado `MetricsModule` na pasta `src/metrics/`.

### 2.1. MetricsService (`src/metrics/metrics.service.ts`)
Criar o serviço responsável por gerenciar o registry e as métricas.

**Requisitos:**
- Inicializar `promClient.collectDefaultMetrics()` no construtor.
- Definir um `Counter` chamado `http_requests_total` com as labels: `['method', 'route', 'status_code']`.
- Definir um `Histogram` chamado `http_request_duration_seconds` com as labels: `['method', 'route', 'status_code']` e buckets adequados (ex: `[0.1, 0.3, 0.5, 1, 1.5, 2, 5, 10]`).
- O método `getMetrics()` deve retornar o texto com as métricas extraído através de `promClient.register.metrics()`.
- Criar métodos auxiliares para atualizar o histograma e o contador.

### 2.2. HttpMetricsInterceptor (`src/metrics/http-metrics.interceptor.ts`)
Criar um interceptor para capturar e registrar automaticamente o ciclo de vida HTTP.

**Requisitos:**
- Implementar a interface `NestInterceptor`.
- Injetar o `MetricsService`.
- No método `intercept`, obter o timestamp de início da requisição.
- Utilizar o operador `tap` do RxJS para capturar o `statusCode` final da resposta, o `method` da requisição e o caminho (`route`).
- Ignorar o próprio endpoint de métricas (`/metrics`), evitando um loop infinito de registro que mascara as verdadeiras requisições de negócio.
- Chamar o `MetricsService` passando os labels coletados e a duração da requisição (em segundos).

**Registro:**
Registrar como interceptor global fornecendo o token `APP_INTERCEPTOR` no `MetricsModule`:
```typescript
{
  provide: APP_INTERCEPTOR,
  useClass: HttpMetricsInterceptor,
}
```

### 2.3. MetricsController (`src/metrics/metrics.controller.ts`)
Criar o controller focado no endpoint de exposição das métricas.

**Requisitos:**
- Rota: `GET /metrics`.
- O retorno deve ser o conteúdo textual do `MetricsService.getMetrics()`.
- Especificar o `Content-Type` do cabeçalho de resposta através de `promClient.register.contentType`.
- **Autenticação:** O Prometheus realiza as consultas sem cabeçalhos de autorização. Logo, o endpoint deve estar público. Utilizar a anotação padrão do projeto para rotas públicas (ex: `@Public()` associado ao guard JWT local do serviço).

### 2.4. MetricsModule (`src/metrics/metrics.module.ts`)
- Utilizar o decorator `@Global()`.
- Providers: `MetricsService` e o registro do `APP_INTERCEPTOR`.
- Controllers: `MetricsController`.
- Exports: `MetricsService`.

## 3. Integração
Registrar o `MetricsModule` na seção de imports do `AppModule` em `src/app.module.ts`.

## 4. Métricas Expostas

| Nome da Métrica | Tipo | Labels | Descrição |
| :--- | :--- | :--- | :--- |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total de requisições recebidas pelo serviço |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Duração das requisições em segundos |
| *(Default)* | Vários | Vários | Métricas padrão do Node.js (memória, cpu, event loop) |

## 5. Critérios de Aceite
1. O `prom-client` foi adicionado ao pacote e instanciado corretamente.
2. Acessar `GET /metrics` retorna os dados formatados corretamente com status 200.
3. Não é necessário enviar token JWT para acessar o `/metrics`.
4. Múltiplos acessos ao `/metrics` não incrementam o contador de `http_requests_total` e não registram no histograma `http_request_duration_seconds`.
5. O histograma `http_request_duration_seconds` e o contador `http_requests_total` aparecem na listagem junto com as labels associadas (`method`, `route`, `status_code`).
6. Acesso às rotas do serviço devem incrementar as métricas corretamente.
7. O Prometheus da stack local deve reportar o `checkout-service` como alvo com status **UP** na interface web.
