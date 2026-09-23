// ========================================
// Mocks — DEVEM vir ANTES dos imports
// ========================================

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('telegraf', () => ({
  Telegraf: jest.fn().mockImplementation(() => ({
    use: jest.fn(), command: jest.fn(), on: jest.fn(), action: jest.fn(), launch: jest.fn(),
    telegram: { sendMessage: jest.fn().mockResolvedValue({}) },
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

const mockProcessarNotificacaoExterna = jest.fn();
jest.mock('../../src/services/botLoadService', () => ({
  processarNotificacaoExterna: (...args: any[]) => mockProcessarNotificacaoExterna(...args),
  bot: { telegram: { sendMessage: jest.fn() } },
  startBot: jest.fn(),
  extrairValor: jest.fn(),
  extrairData: jest.fn(),
  extrairEstabelecimento: jest.fn(),
  extrairBanco: jest.fn(),
  processarNotificacao: jest.fn(),
  formatarResumo: jest.fn(),
  converterParaSheetData: jest.fn(),
  inserirNaPlanilha: jest.fn(),
  obterDadosExtraidos: jest.fn(),
  armazenarDadosExtraidos: jest.fn(),
  pendingData: new Map(),
  MESES_NOMES: [],
}));

// ========================================
// Configuração de ambiente (ANTES do import do módulo)
// ========================================

process.env.TELEGRAM_CHAT_ID = '123456';

// ========================================
// Imports — DEPOIS dos mocks e env
// ========================================

import request from 'supertest';
import { app } from '../../src/services/receiveText';

// ========================================
// Testes
// ========================================

describe('POST /webhook-macrodroid', () => {
  const ENDPOINT = '/webhook-macrodroid';

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidarToken.mockResolvedValue(true);
  });

  // ----- Autenticação -----

  it('deve retornar 401 quando o header Authorization não é fornecido', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .send({ texto: 'Compra de R$50,00 no Mercado' });

    expect(response.status).toBe(401);
    expect(response.body.erro).toContain('Token de autenticação não fornecido');
  });

  it('deve retornar 401 quando o Authorization não começa com "Bearer "', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Basic abc123')
      .send({ texto: 'Compra de R$50,00 no Mercado' });

    expect(response.status).toBe(401);
    expect(response.body.erro).toContain('Token de autenticação não fornecido');
  });

  it('deve retornar 401 quando o token é inválido', async () => {
    mockValidarToken.mockResolvedValue(false);

    const response = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer token-invalido')
      .send({ texto: 'Compra de R$50,00 no Mercado' });

    expect(response.status).toBe(401);
    expect(response.body.erro).toContain('Token de autenticação inválido');
  });

  // ----- Validação do body -----

  it('deve retornar 400 quando o campo "texto" não é fornecido', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer token-valido')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.erro).toContain('Campo "texto" é obrigatório');
  });

  it('deve retornar 400 quando o campo "texto" está vazio', async () => {
    const response = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer token-valido')
      .send({ texto: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.erro).toContain('Campo "texto" é obrigatório');
  });

  // ----- Processamento -----

  it('deve retornar 422 quando processarNotificacaoExterna retorna null', async () => {
    mockProcessarNotificacaoExterna.mockResolvedValue(null);

    const response = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer token-valido')
      .send({ texto: 'texto sem dados extraíveis' });

    expect(response.status).toBe(422);
    expect(response.body.erro).toContain('Não foi possível extrair informações');
  });

  it('deve retornar 200 com texto válido e token correto', async () => {
    const dadosMock = {
      estabelecimento: 'Mercado Central',
      valor: 50.0,
      data: '22/09/2026',
      banco: 'Nubank',
    };
    mockProcessarNotificacaoExterna.mockResolvedValue(dadosMock);

    const response = await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer token-valido')
      .send({ texto: 'Compra de R$50,00 no Mercado Central' });

    expect(response.status).toBe(200);
    expect(response.body.mensagem).toContain('Notificação recebida');
    expect(response.body.dados).toEqual(dadosMock);
  });

  it('deve chamar processarNotificacaoExterna com chatId e texto corretos', async () => {
    const dadosMock = {
      estabelecimento: 'Padaria',
      valor: 12.5,
      data: '22/09/2026',
      banco: 'Inter',
    };
    mockProcessarNotificacaoExterna.mockResolvedValue(dadosMock);

    const textoEnviado = '  Compra de R$12,50 na Padaria  ';

    await request(app)
      .post(ENDPOINT)
      .set('Authorization', 'Bearer token-valido')
      .send({ texto: textoEnviado });

    expect(mockProcessarNotificacaoExterna).toHaveBeenCalledTimes(1);
    expect(mockProcessarNotificacaoExterna).toHaveBeenCalledWith(
      123456,
      textoEnviado.trim(),
    );
  });
});
