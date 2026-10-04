# Plano de Ação — Sistema de Filas Unificado

## Bug Reportado

Quando o usuário digita `/fails` no Telegram, o bot responde com:
> "⚠️ Não consegui extrair as informações dessa mensagem."

**Causa raiz**: O comando `bot.command('fails')` está registrado **DEPOIS** de `bot.on(message('text'))` no `botLoadService.ts`. O Telegraf processa middleware na ordem de registro — então o handler de texto captura "/fails" como notificação e tenta processar, falhando.

**Além disso**: A arquitetura com múltiplos mecanismos separados (`pendingData`, `reprocessQueues`, `session.falhasEmRevisao`) é fragmentada e causa conflitos.

---

## Arquitetura Nova — Fila Unificada

### Conceito Central

Uma **fila única por chatId** onde tudo passa:
- Itens do MacroDroid (POST `/webhook-macrodroid`) → fila
- Itens do reprocessamento (POST `/reprocess-pending`) → fila
- Itens do `/fails` (carregar falhas salvas) → fila
- O usuário sempre interage com a fila: **Adicionar / Editar / Descartar / Continuar depois**
- "Continuar depois" → salva restantes em arquivo JSON
- Verificação de duplicatas antes de adicionar à fila

### Diagrama de Fluxo

```
MacroDroid POST ─────┐
                     ├──→ FILA (memória) ──→ Mostrar item 1 ──→ Usuário age ──→ Próximo item
Reprocess POST ──────┤                         ↓                    ↓
                     │                    [Adicionar]          [Continuar depois]
/fails (Telegram) ───┘                    → Planilha           → Salva em JSON
                                          → Se falhar,
                                            salva em failedInsertions
```

---

## Passo 1: Criar `queueService.ts`

> **Arquivo**: `src/services/queueService.ts`

### Interface

```typescript
interface QueueItem {
  id: string;
  texto: string;
  banco: string;
  origem: 'macrodroid' | 'reprocess' | 'falha';
  adicionadoEm: string;
  // Para itens vindos de falhas: dados já processados (não precisa reprocessar texto)
  dadosProcessados?: {
    estabelecimento: string;
    valor: string;
    data: string;
    banco: string | null;
  };
  // ID da FailedInsertion original (para remover do arquivo após sucesso)
  falhaId?: string;
}
```

### Funções

| Função | Descrição |
|---|---|
| `obterFila(chatId)` | Retorna array da fila em memória (cria se não existe) |
| `isDuplicata(chatId, texto, banco)` | Verifica se item com mesmo texto+banco já está na fila |
| `adicionarItensNaFila(chatId, itens[])` | Adiciona itens, ignorando duplicatas. Retorna count |
| `proximoItem(chatId)` | **Peek** — retorna primeiro item SEM remover |
| `removerPrimeiroItem(chatId)` | **Pop** — remove e retorna primeiro item |
| `contarItens(chatId)` | Conta itens na fila em memória |
| `salvarFilaEmDisco(chatId)` | Salva fila em `~/INIT_DIR/queue/{chatId}.json`, limpa memória |
| `carregarFilaDoDisco(chatId)` | Carrega do JSON para memória, deleta arquivo |
| `limparFila(chatId)` | Limpa fila em memória |

### Armazenamento

- **Em memória**: `Map<number, QueueItem[]>` (filas por chatId)
- **Em disco**: `~/INIT_DIR/queue/{chatId}.json` (para "continuar depois")
- Arquivo separado do `failedInsertionsService` (que continua existindo para falhas de inserção)

---

## Passo 2: Modificar `botLoadService.ts`

### 2.1 — Imports

```diff
+ import { adicionarItensNaFila, proximoItem, removerPrimeiroItem, contarItens, salvarFilaEmDisco, carregarFilaDoDisco, limparFila } from './queueService';
+ import type { QueueItem } from './queueService';
```

### 2.2 — Simplificar `UserSessionData`

```typescript
// ANTES (6 campos extras):
interface UserSessionData {
  etapa: string;
  dadosExtraidos: DadosNotificacao | null;
  falhasEmRevisao: FailedInsertion[] | null;  // REMOVER
  indiceFalhaAtual: number;                    // REMOVER
  falhaAtualId: string | null;                 // REMOVER
  reprocessItems: PendingReprocessItem[] | null; // REMOVER
  reprocessIndice: number;                      // REMOVER
}

// DEPOIS (1 campo extra):
interface UserSessionData {
  etapa: string;
  dadosExtraidos: DadosNotificacao | null;
}
```

### 2.3 — Remover `PendingReprocessItem`

Interface `PendingReprocessItem` no botLoadService é desnecessária — usar `QueueItem` do queueService.

### 2.4 — Remover funções antigas

Remover COMPLETAMENTE estas funções do botLoadService:

| Função | Razão |
|---|---|
| `formatarResumoFalha()` | Substituída pelo fluxo unificado |
| `mostrarFalhaAtual()` | Substituída por `mostrarProximoItemFila()` |
| `mostrarProximaFalha()` | Substituída por `mostrarProximoItemFila()` |
| `iniciarFilaReprocess()` (antiga) | Reescrever usando queueService |
| `mostrarProximoReprocessItem()` | Substituída por `mostrarProximoItemFila()` |
| `salvarRestantesComoFalhas()` | Substituída por `salvarFilaEmDisco()` |

Remover também:
- `reprocessQueues: Map<number, ...>` (substituído por queueService.filas)

### 2.5 — Adicionar nova função central: `mostrarProximoItemFila(chatId)`

```typescript
async function mostrarProximoItemFila(chatId: number): Promise<void> {
  const item = proximoItem(chatId);
  
  if (!item) {
    await bot.telegram.sendMessage(chatId, '✅ Todos os itens da fila foram processados!');
    return;
  }
  
  const total = contarItens(chatId);
  
  // Se o item tem dados já processados (veio de falha), usar diretamente
  // Senão, processar o texto
  let dados: DadosNotificacao | null;
  if (item.dadosProcessados) {
    dados = {
      estabelecimento: item.dadosProcessados.estabelecimento,
      valor: item.dadosProcessados.valor,
      data: item.dadosProcessados.data,
      banco: item.dadosProcessados.banco,
    };
  } else {
    dados = processarNotificacao(item.texto, item.banco);
  }
  
  if (!dados) {
    // Não processável → pula automaticamente
    await bot.telegram.sendMessage(chatId,
      `⏭️ Item não processável (sem valor/estabelecimento). Pulando...`,
    );
    removerPrimeiroItem(chatId);
    await mostrarProximoItemFila(chatId); // Recursão para próximo
    return;
  }
  
  // Armazena para os action handlers usarem
  pendingData.set(chatId, dados);
  
  const resumo = formatarResumo(dados);
  await bot.telegram.sendMessage(chatId,
    `📋 *Item 1 de ${total}*\n\n${resumo}`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Adicionar', 'adicionar')],
        [Markup.button.callback('✏️ Editar', 'editar')],
        [Markup.button.callback('🗑️ Descartar', 'queue_discard')],
        [Markup.button.callback('⏸️ Continuar depois', 'queue_later')],
      ]),
    }
  );
}
```

### 2.6 — Reescrever `processarNotificacaoExterna()`

```typescript
async function processarNotificacaoExterna(chatId: number, texto: string, banco?: string): Promise<DadosNotificacao | null> {
  const dados = processarNotificacao(texto, banco);
  
  if (!dados) {
    await bot.telegram.sendMessage(chatId, '⚠️ Não consegui extrair as informações...');
    return null;
  }
  
  // Adiciona na fila unificada
  const filaEstavaVazia = contarItens(chatId) === 0;
  adicionarItensNaFila(chatId, [{ texto, banco: banco ?? '', origem: 'macrodroid' }]);
  
  // Se a fila estava vazia, mostra o item
  if (filaEstavaVazia) {
    await mostrarProximoItemFila(chatId);
  } else {
    const total = contarItens(chatId);
    await bot.telegram.sendMessage(chatId,
      `📡 Notificação adicionada à fila. ${total} item(ns) pendente(s).`
    );
  }
  
  return dados;
}
```

### 2.7 — Reescrever `iniciarFilaReprocess()`

```typescript
async function iniciarFilaReprocess(chatId: number, itens: { texto: string; banco: string }[]): Promise<void> {
  const adicionados = adicionarItensNaFila(chatId,
    itens.map(i => ({ texto: i.texto, banco: i.banco, origem: 'reprocess' as const }))
  );
  
  await bot.telegram.sendMessage(chatId,
    `📡 *${adicionados} item(ns) adicionado(s) à fila.*`,
    { parse_mode: 'Markdown' }
  );
  
  await mostrarProximoItemFila(chatId);
}
```

### 2.8 — Reordenar comandos no `startBot()`

> [!CAUTION]
> CRÍTICO: Mover `bot.command('fails')` ANTES de `bot.on(message('text'))`. Este é o fix do bug principal.

Ordem correta:
```typescript
bot.command('start', ...);
bot.command('token', ...);
bot.command('fails', ...);   // ← MOVER PARA AQUI (antes do on(text))
bot.on(message('text'), ...); // ← handlers de texto depois dos comandos
```

### 2.9 — Reescrever comando `/fails`

```typescript
bot.command('fails', async (ctx) => {
  const chatId = ctx.chat.id;
  
  // 1. Carrega itens adiados do arquivo da fila
  const carregadosDaFila = await carregarFilaDoDisco(chatId);
  
  // 2. Carrega itens de inserções falhadas
  const falhas = await listarFalhas(chatId);
  if (falhas.length > 0) {
    const itensDeFalhas = falhas.map(f => ({
      texto: `${f.estabelecimento} R$ ${f.valor}`, // texto reconstruído (usado apenas para duplicata check)
      banco: f.bancoSelecionado,
      origem: 'falha' as const,
      dadosProcessados: {
        estabelecimento: f.estabelecimento,
        valor: f.valor,
        data: f.data,
        banco: f.banco,
      },
      falhaId: f.id,
    }));
    adicionarItensNaFila(chatId, itensDeFalhas);
  }
  
  const total = contarItens(chatId);
  if (total === 0) {
    await ctx.reply('✅ Nenhum item pendente!');
    return;
  }
  
  await ctx.reply(`📋 *${total}* item(ns) carregado(s) na fila.`, { parse_mode: 'Markdown' });
  await mostrarProximoItemFila(chatId);
});
```

### 2.10 — Atualizar handler `inserir_(.+)`

```typescript
bot.action(/^inserir_(.+)$/, async (ctx) => {
  // ... (manter lógica de inserção) ...
  
  // APÓS inserção (sucesso ou falha):
  armazenarDadosExtraidos(chatId, session, null);
  
  const estaProcessandoFila = contarItens(chatId) > 0;
  
  if (sucesso) {
    // Se veio de uma falha, remover do arquivo de falhas
    const item = proximoItem(chatId); // peek antes de remover
    if (item?.falhaId) {
      await removerFalha(chatId, item.falhaId);
    }
  }
  // Se falhou, registrar em failedInsertions (comportamento existente)
  
  // Remove item da fila e mostra próximo
  if (estaProcessandoFila) {
    removerPrimeiroItem(chatId);
    await mostrarProximoItemFila(chatId);
  } else {
    session.etapa = '';
  }
});
```

### 2.11 — Novas actions

```typescript
// Descartar item da fila
bot.action('queue_discard', async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const item = proximoItem(chatId);
  
  // Se veio de falha, remover do arquivo de falhas também
  if (item?.falhaId) {
    await removerFalha(chatId, item.falhaId);
  }
  
  removerPrimeiroItem(chatId);
  armazenarDadosExtraidos(chatId, session, null);
  await ctx.reply('🗑️ Item descartado.');
  await mostrarProximoItemFila(chatId);
});

// Continuar depois — salva restantes em disco
bot.action('queue_later', async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const salvos = await salvarFilaEmDisco(chatId);
  armazenarDadosExtraidos(chatId, session, null);
  
  await ctx.reply(
    `⏸️ Fila pausada. *${salvos}* item(ns) salvo(s).\nUse /fails para continuar.`,
    { parse_mode: 'Markdown' }
  );
});
```

### 2.12 — Remover actions antigas

Remover completamente:
- `fails_retry`
- `fails_skip`
- `fails_cancel`
- `reprocess_discard`
- `reprocess_later`

### 2.13 — Atualizar `ignorar` para suportar fila

```typescript
bot.action('ignorar', async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const session = ctx.session as UserSessionData;
  armazenarDadosExtraidos(chatId, session, null);
  
  const estaProcessandoFila = contarItens(chatId) > 0;
  if (estaProcessandoFila) {
    // Funciona como descartar na fila
    const item = proximoItem(chatId);
    if (item?.falhaId) await removerFalha(chatId, item.falhaId);
    removerPrimeiroItem(chatId);
    await ctx.reply('🗑️ Item ignorado.');
    await mostrarProximoItemFila(chatId);
  } else {
    session.etapa = '';
    await ctx.reply('🗑️ Entrada ignorada.');
  }
});
```

### 2.14 — Atualizar exports

```typescript
export {
  startBot, setupWebhook, getWebhookCallback, bot,
  processarNotificacaoExterna, iniciarFilaReprocess, inserirNaPlanilha,
  mostrarProximoItemFila,
  extrairValor, extrairData, extrairEstabelecimento, extrairBanco,
  processarNotificacao, formatarResumo, converterParaSheetData,
  obterDadosExtraidos, armazenarDadosExtraidos,
  pendingData, MESES_NOMES,
};
export type { DadosNotificacao, UserSessionData };
```

---

## Passo 3: Atualizar `receiveText.ts`

Mudanças mínimas:
- Manter a interface `PendingReprocessItem` local (usada para parsear o body HTTP)
- `iniciarFilaReprocess` continua sendo importada do botLoadService (interface mudou)
- Remover `PendingReprocessItem` dos exports (já existe como `QueueItem` no queueService)

---

## Passo 4: Atualizar mocks dos testes existentes

### Todos os arquivos de teste que mockam `botLoadService` precisam:

```diff
- mostrarFalhaAtual: jest.fn(),
- mostrarProximaFalha: jest.fn(),
- mostrarProximoReprocessItem: jest.fn(),
- salvarRestantesComoFalhas: jest.fn(),
- formatarResumoFalha: jest.fn(),
- reprocessQueues: new Map(),
+ mostrarProximoItemFila: jest.fn(),
```

### Adicionar mock do `queueService` em TODOS os arquivos de teste:

```typescript
jest.mock('../../src/services/queueService', () => ({
  adicionarItensNaFila: jest.fn().mockReturnValue(1),
  proximoItem: jest.fn().mockReturnValue(null),
  removerPrimeiroItem: jest.fn().mockReturnValue(null),
  contarItens: jest.fn().mockReturnValue(0),
  salvarFilaEmDisco: jest.fn().mockResolvedValue(0),
  carregarFilaDoDisco: jest.fn().mockResolvedValue(0),
  limparFila: jest.fn(),
  isDuplicata: jest.fn().mockReturnValue(false),
  obterFila: jest.fn().mockReturnValue([]),
  gerarIdQueue: jest.fn().mockReturnValue('q-mock'),
  getQueueDir: jest.fn().mockReturnValue('/tmp/queue'),
  getQueueFilePath: jest.fn().mockReturnValue('/tmp/queue/123.json'),
  filas: new Map(),
}));
```

### Arquivos de teste que precisam de atualização:

| Arquivo | Mudanças |
|---|---|
| `tests/unit/botLoadService.test.ts` | Adicionar mock queueService, remover exports antigos |
| `tests/e2e/botLoadService.e2e.test.ts` | Adicionar mock queueService, remover exports antigos |
| `tests/unit/receiveText.test.ts` | Atualizar mock botLoadService |
| `tests/e2e/receiveText.e2e.test.ts` | Adicionar mock queueService |
| `tests/unit/reprocessPending.test.ts` | Atualizar mock botLoadService |
| `tests/e2e/reprocessPending.e2e.test.ts` | Adicionar mock queueService |
| `tests/e2e/failedInsertions.e2e.test.ts` | Atualizar imports/mocks |

---

## Passo 5: Criar testes do `queueService`

> **Arquivo**: `tests/unit/queueService.test.ts`

Testes a criar:
1. `gerarIdQueue` — gera IDs únicos
2. `getQueueFilePath` — retorna path com chatId
3. `adicionarItensNaFila` — adiciona itens, conta correto
4. `adicionarItensNaFila` — ignora duplicatas (mesmo texto+banco)
5. `proximoItem` — retorna primeiro sem remover (peek)
6. `proximoItem` — retorna null quando fila vazia
7. `removerPrimeiroItem` — remove e retorna primeiro (pop)
8. `contarItens` — contagem correta
9. `salvarFilaEmDisco` — salva em JSON e limpa memória
10. `carregarFilaDoDisco` — carrega do JSON e deleta arquivo
11. `limparFila` — limpa fila em memória

> **Arquivo**: `tests/e2e/queueService.e2e.test.ts`

Testes E2E:
1. Fluxo: adicionar → peek → pop → vazia
2. Fluxo: adicionar duplicatas → contagem correta
3. Fluxo: adicionar → salvar em disco → carregar → verificar
4. Fluxo: múltiplos chatIds independentes

---

## Passo 6: Verificar

```bash
npx tsc --noEmit    # Compilação limpa
npx jest --verbose  # Todos os testes passando
```

---

## Checklist de Execução

- [ ] Criar `src/services/queueService.ts`
- [ ] Modificar `src/services/botLoadService.ts`:
  - [ ] Atualizar imports
  - [ ] Simplificar `UserSessionData` (remover 5 campos)
  - [ ] Remover `PendingReprocessItem`
  - [ ] Remover funções antigas (6 funções)
  - [ ] Remover `reprocessQueues` map
  - [ ] Adicionar `mostrarProximoItemFila()`
  - [ ] Reescrever `processarNotificacaoExterna()` → usar fila
  - [ ] Reescrever `iniciarFilaReprocess()` → usar fila
  - [ ] **MOVER** `bot.command('fails')` ANTES de `bot.on(message('text'))` ← FIX DO BUG
  - [ ] Reescrever `/fails` → carregar de falhas + disco → fila
  - [ ] Atualizar handler `inserir_(.+)` → avançar fila após ação
  - [ ] Atualizar handler `ignorar` → suportar fila
  - [ ] Adicionar actions `queue_discard` e `queue_later`
  - [ ] Remover actions antigas (5 actions)
  - [ ] Atualizar exports
- [ ] Atualizar `src/services/receiveText.ts` (imports, remover export PendingReprocessItem)
- [ ] Atualizar session initialization no `startBot()`
- [ ] Atualizar mocks em 7 arquivos de teste
- [ ] Criar `tests/unit/queueService.test.ts`
- [ ] Criar `tests/e2e/queueService.e2e.test.ts`
- [ ] Verificar compilação TypeScript
- [ ] Executar todos os testes
