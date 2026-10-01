// Configuração de ambiente ANTES dos mocks
process.env.TELEGRAM_CHAT_ID = '123456';
process.env.WEBHOOK_SECRET = 'test-secret';

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => ({
    use: jest.fn(), command: jest.fn(), on: jest.fn(), action: jest.fn(), launch: jest.fn(),
    telegram: { sendMessage: jest.fn().mockResolvedValue({}) },
    webhookCallback: jest.fn().mockReturnValue((_req: any, _res: any, next: any) => next?.()),
  })),
  Markup: { inlineKeyboard: jest.fn(() => ({})), button: { callback: jest.fn(() => ({})) } },
  session: jest.fn(() => jest.fn()),
}));

jest.mock('telegraf/filters', () => ({ message: jest.fn((type: string) => `message:${type}`) }));

jest.mock('../../src/services/googleSheetsComunicationService', () => ({
  GoogleSheetsComunicationService: jest.fn().mockImplementation(() => ({
    inserirInformacoesPlanilha: jest.fn().mockResolvedValue(undefined),
  })),
}));

const mockValidarToken = jest.fn();
jest.mock('../../src/services/tokenService', () => ({
  validarToken: (...args: any[]) => mockValidarToken(...args),
  gerarToken: jest.fn().mockResolvedValue('mock-token'),
  getTokenFilePath: jest.fn().mockReturnValue('/tmp/tokens.json'),
}));

const mockIniciarFilaReprocess = jest.fn();
jest.mock('../../src/services/botLoadService', () => ({
  processarNotificacaoExterna: jest.fn(),
  bot: { telegram: { sendMessage: jest.fn() } },
  startBot: jest.fn(),
  setupWebhook: jest.fn(),
  getWebhookCallback: jest.fn().mockReturnValue({
    path: '/webhook-telegram-test',
    handler: (_req: any, _res: any, next: any) => next?.(),
  }),
  iniciarFilaReprocess: (...args: any[]) => mockIniciarFilaReprocess(...args),
  extrairValor: jest.fn(),
  extrairData: jest.fn(),
  extrairEstabelecimento: jest.fn(),
  extrairBanco: jest.fn(),
  processarNotificacao: jest.fn(),
  formatarResumo: jest.fn(),
  formatarResumoFalha: jest.fn(),
  converterParaSheetData: jest.fn(),
  inserirNaPlanilha: jest.fn(),
  obterDadosExtraidos: jest.fn(),
  armazenarDadosExtraidos: jest.fn(),
  mostrarFalhaAtual: jest.fn(),
  mostrarProximaFalha: jest.fn(),
  mostrarProximoReprocessItem: jest.fn(),
  salvarRestantesComoFalhas: jest.fn(),
  reprocessQueues: new Map(),
  pendingData: new Map(),
  MESES_NOMES: [],
}));

jest.mock('../../src/services/failedInsertionsService', () => ({
  registrarFalha: jest.fn().mockResolvedValue({ id: 'mock-id' }),
  listarFalhas: jest.fn().mockResolvedValue([]),
  removerFalha: jest.fn().mockResolvedValue(true),
  contarFalhas: jest.fn().mockResolvedValue(0),
  getFailedInsertionsDir: jest.fn().mockReturnValue('/tmp/failed_insertions'),
  getFailedInsertionsFilePath: jest.fn().mockReturnValue('/tmp/failed_insertions/123.json'),
  gerarIdFalha: jest.fn().mockReturnValue('mock-id'),
}));

import request from 'supertest';
import { app, corrigirEParsearJson } from '../../src/services/receiveText';

describe('corrigirEParsearJson', () => {
  it('Deve parsear JSON mal-formado (objetos separados por vírgula com trailing comma)', () => {
    const raw = '{ "texto": "abc", "banco": "Nu" },{ "texto": "def", "banco": "Itau" },';
    const result = corrigirEParsearJson(raw);
    expect(result).toEqual([
      { texto: 'abc', banco: 'Nu' },
      { texto: 'def', banco: 'Itau' }
    ]);
  });

  it('Deve parsear JSON já válido (array correto)', () => {
    const raw = '[{ "texto": "abc", "banco": "Nu" }]';
    const result = corrigirEParsearJson(raw);
    expect(result).toEqual([{ texto: 'abc', banco: 'Nu' }]);
  });

  it('Deve parsear um único objeto sem array', () => {
    const raw = '{ "texto": "abc", "banco": "Nu" }';
    const result = corrigirEParsearJson(raw);
    expect(result).toEqual([{ texto: 'abc', banco: 'Nu' }]);
  });

  it('Deve lançar erro para string completamente inválida', () => {
    const raw = 'string invalida {';
    expect(() => corrigirEParsearJson(raw)).toThrow(SyntaxError);
  });

  it('Deve remover múltiplas trailing commas', () => {
    const raw = '{ "texto": "abc", "banco": "Nu" },';
    const result = corrigirEParsearJson(raw);
    expect(result).toEqual([{ texto: 'abc', banco: 'Nu' }]);
  });

  it('Deve funcionar com espaços em branco extras', () => {
    const raw = '  { "texto": "abc", "banco": "Nu" }  ';
    const result = corrigirEParsearJson(raw);
    expect(result).toEqual([{ texto: 'abc', banco: 'Nu' }]);
  });
});

describe('POST /reprocess-pending', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidarToken.mockResolvedValue(true);
    mockIniciarFilaReprocess.mockResolvedValue(undefined);
  });

  it('Retorna 401 sem Authorization', async () => {
    const res = await request(app)
      .post('/reprocess-pending')
      .set('Content-Type', 'text/plain')
      .send('{ "texto": "abc", "banco": "Nu" }');
    expect(res.status).toBe(401);
  });

  it('Retorna 401 com token inválido', async () => {
    mockValidarToken.mockResolvedValue(false);
    const res = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', 'Bearer token-invalido')
      .set('Content-Type', 'text/plain')
      .send('{ "texto": "abc", "banco": "Nu" }');
    expect(res.status).toBe(401);
  });

  it('Retorna 400 com body vazio', async () => {
    const res = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', 'Bearer token-valido')
      .set('Content-Type', 'text/plain')
      .send('');
    expect(res.status).toBe(400);
  });

  it('Retorna 400 com JSON completamente inválido', async () => {
    const res = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', 'Bearer token-valido')
      .set('Content-Type', 'text/plain')
      .send('invalido');
    expect(res.status).toBe(400);
  });

  it('Retorna 422 quando todos os itens têm texto vazio', async () => {
    const res = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', 'Bearer token-valido')
      .set('Content-Type', 'text/plain')
      .send('{ "texto": "", "banco": "Nu" }, { "texto": "   ", "banco": "Itau" }');
    expect(res.status).toBe(422);
  });

  it('Retorna 200 com itens válidos — usa Content-Type text/plain e envia como string raw', async () => {
    const res = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', 'Bearer token-valido')
      .set('Content-Type', 'text/plain')
      .send('{ "texto": "compra 1", "banco": "Nu" }');
    expect(res.status).toBe(200);
    expect(res.body.mensagem).toContain('Recebidos 1 item');
  });

  it('Deve filtrar itens com texto vazio — verifica que iniciarFilaReprocess recebeu apenas os válidos', async () => {
    const res = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', 'Bearer token-valido')
      .set('Content-Type', 'text/plain')
      .send('{ "texto": "compra 1", "banco": "Nu" }, { "texto": "  ", "banco": "Itau" }');
    expect(res.status).toBe(200);
    expect(mockIniciarFilaReprocess).toHaveBeenCalledWith(123456, [{ texto: 'compra 1', banco: 'Nu' }]);
  });

  it('Deve chamar iniciarFilaReprocess com chatId e itens corretos', async () => {
    await request(app)
      .post('/reprocess-pending')
      .set('Authorization', 'Bearer token-valido')
      .set('Content-Type', 'text/plain')
      .send('{ "texto": "compra 1", "banco": "Nu" }, { "texto": "compra 2", "banco": "Itau" }');
    
    expect(mockIniciarFilaReprocess).toHaveBeenCalledWith(123456, [
      { texto: 'compra 1', banco: 'Nu' },
      { texto: 'compra 2', banco: 'Itau' }
    ]);
  });
});
