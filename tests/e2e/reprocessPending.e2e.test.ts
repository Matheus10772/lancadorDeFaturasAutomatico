process.env.TELEGRAM_CHAT_ID = '123456';
process.env.WEBHOOK_SECRET = 'test-secret';

jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockSendMessage = jest.fn().mockResolvedValue({});
jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => ({
    use: jest.fn(), command: jest.fn(), on: jest.fn(), action: jest.fn(), launch: jest.fn(),
    telegram: { sendMessage: mockSendMessage, deleteWebhook: jest.fn(), setWebhook: jest.fn() },
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

let tokensEmMemoria: string[] = [];
jest.mock('../../src/services/tokenService', () => ({
  gerarToken: jest.fn().mockImplementation(async () => {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    tokensEmMemoria.push(token);
    return token;
  }),
  validarToken: jest.fn().mockImplementation(async (token: string) => {
    return tokensEmMemoria.includes(token);
  }),
  revogarToken: jest.fn().mockImplementation(async (token: string) => {
    const idx = tokensEmMemoria.indexOf(token);
    if (idx >= 0) { tokensEmMemoria.splice(idx, 1); return true; }
    return false;
  }),
  getTokenFilePath: jest.fn().mockReturnValue('/tmp/tokens.json'),
}));

jest.mock('../../src/services/queueService', () => ({
	adicionarItensNaFila: jest.fn().mockReturnValue(1),
	proximoItem: jest.fn().mockReturnValue(null),
	removerPrimeiroItem: jest.fn().mockReturnValue(null),
	atualizarPrimeiroItem: jest.fn().mockReturnValue(null),
	contarItens: jest.fn().mockReturnValue(0),
	salvarFilasEmDisco: jest.fn().mockResolvedValue(0),
	salvarSeModificada: jest.fn().mockResolvedValue(false),
	carregarFilasDoDisco: jest.fn().mockResolvedValue(0),
	iniciarPersistenciaPeriodica: jest.fn(),
	haAlteracoesNaoSalvas: jest.fn().mockReturnValue(false),
	limparFila: jest.fn(),
	isDuplicata: jest.fn().mockReturnValue(false),
	obterFila: jest.fn().mockReturnValue([]),
	gerarIdQueue: jest.fn().mockReturnValue('q-mock'),
	getQueueDir: jest.fn().mockReturnValue('/tmp/queue'),
	getQueueFilePath: jest.fn().mockReturnValue('/tmp/queue/123.json'),
	filas: new Map(),
}));

jest.mock('../../src/services/failedInsertionsService', () => ({
  registrarFalha: jest.fn().mockResolvedValue({ id: 'mock-id' }),
  listarFalhas: jest.fn().mockResolvedValue([]),
  removerFalha: jest.fn().mockResolvedValue(true),
  removerFalhasDoItem: jest.fn().mockResolvedValue(0),
  contarFalhas: jest.fn().mockResolvedValue(0),
  getFailedInsertionsDir: jest.fn().mockReturnValue('/tmp/failed_insertions'),
  getFailedInsertionsFilePath: jest.fn().mockReturnValue('/tmp/failed_insertions/123.json'),
  gerarIdFalha: jest.fn().mockReturnValue('mock-id'),
}));

import request from 'supertest';
import { app, corrigirEParsearJson } from '../../src/services/receiveText';
import { gerarToken } from '../../src/services/tokenService';

describe('POST /reprocess-pending', () => {
  beforeEach(() => {
    tokensEmMemoria.length = 0;
    jest.clearAllMocks();
  });

  it('1. Fluxo completo: gerar token → enviar JSON mal-formado → receber 200', async () => {
    const token = await gerarToken();
    const jsonMalFormado = `{
    "texto": "Compra de R$ 31,89 APROVADA em BEM - VILA DA SERRA para o cartão com final 0499.",
    "banco": "Nubank"
},{
    "texto": "",
    "banco": "Nubank"
},{
    "texto": "Compra de R$ 33,75 APROVADA em Araujo  Loja para o cartão com final 0499.",
    "banco": "Nubank"
},`;

    const response = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(jsonMalFormado);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      totalRecebidos: 3,
      totalValidos: 2
    }));
  });

  it('2. Fluxo: token inválido → 401', async () => {
    const response = await request(app)
      .post('/reprocess-pending')
      .set('Content-Type', 'text/plain')
      .send('[]');

    expect(response.status).toBe(401);
  });

  it('3. Fluxo: body vazio → 400', async () => {
    const token = await gerarToken();
    const response = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('');

    expect(response.status).toBe(400);
  });

  it('4. Fluxo: todos os itens com texto vazio → 422', async () => {
    const token = await gerarToken();
    const jsonVazio = `{
    "texto": "",
    "banco": "Nubank"
},{
    "texto": "",
    "banco": "Nubank"
}`;

    const response = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(jsonVazio);

    expect(response.status).toBe(422);
  });

  it('5. Fluxo: JSON já formatado corretamente (array válido) → 200', async () => {
    const token = await gerarToken();
    const jsonValido = '[{"texto": "Compra de R$10 em Loja", "banco": "Nu"}]';

    const response = await request(app)
      .post('/reprocess-pending')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send(jsonValido);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      totalRecebidos: 1,
      totalValidos: 1
    }));
  });
});
