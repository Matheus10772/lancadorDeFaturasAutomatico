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

jest.mock('../../src/services/tokenService', () => ({
  gerarToken: jest.fn().mockResolvedValue('mock-token'),
  validarToken: jest.fn().mockResolvedValue(true),
  getTokenFilePath: jest.fn().mockReturnValue('/tmp/tokens.json'),
}));

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

import {
  processarNotificacao,
  formatarResumoFalha,
  converterParaSheetData,
} from '../../src/services/botLoadService';
import { registrarFalha, listarFalhas, removerFalha, contarFalhas } from '../../src/services/failedInsertionsService';
import type { FailedInsertion } from '../../src/services/failedInsertionsService';

describe('E2E: Fluxo de Falhas de Inserção', () => {
  let inMemoryStore: { falhas: FailedInsertion[] } = { falhas: [] };

  beforeEach(() => {
    jest.clearAllMocks();
    
    inMemoryStore = { falhas: [] };

    // fs/promises mock setup
    mockReadFile.mockImplementation(async (filePath) => {
      return JSON.stringify(inMemoryStore);
    });
    mockWriteFile.mockImplementation(async (filePath, data) => {
      inMemoryStore = JSON.parse(data);
    });
    mockMkdir.mockResolvedValue(undefined);
  });

  it('Fluxo: notificação processada -> falha na inserção -> registra falha', async () => {
    const chatId = 12345;
    const notificacao = 'Compra aprovada no Nubank R$ 100,00 em Mercado Local 10/10/2026';
    
    // Processa notificação
    const dados = processarNotificacao(notificacao, 'Nubank');
    expect(dados).not.toBeNull();
    
    if (!dados) return;

    // Simula que a inserção falhou e registra a falha
    const erroSimulado = 'Erro de timeout na API do Google Sheets';
    await registrarFalha(chatId, dados, 'Nubank', erroSimulado);

    // Verifica que contarFalhas retorna 1
    const total = await contarFalhas(chatId);
    expect(total).toBe(1);

    const falhas = await listarFalhas(chatId);
    expect(falhas[0].estabelecimento).toBe('Mercado Local');
    expect(falhas[0].valor).toBe('R$ 100,00');
    expect(falhas[0].erro).toBe(erroSimulado);
  });

  it('Fluxo: listar falhas -> formatar resumo -> mostrar dados', async () => {
    const chatId = 12345;
    const dados = { estabelecimento: 'Loja', valor: 'R$ 50,00', data: '12/10/2026', banco: 'Itaú' };
    
    // Cria uma falha
    await registrarFalha(chatId, dados, 'Itaú', 'Erro auth');
    const falhas = await listarFalhas(chatId);
    
    expect(falhas.length).toBe(1);

    const falha = falhas[0];
    const resumo = formatarResumoFalha(falha, 0, 1);
    
    expect(resumo).toContain('Falha 1 de 1');
    expect(resumo).toContain('*Estabelecimento:* Loja');
    expect(resumo).toContain('*Valor:* R$ 50,00');
    expect(resumo).toContain('*Data:* 12/10/2026');
    expect(resumo).toContain('*Banco selecionado:* Itaú');
    expect(resumo).toContain('*Erro:* Erro auth');
  });

  it('Fluxo: registrar falha -> remover falha -> verificar lista vazia', async () => {
    const chatId = 12345;
    const dados = { estabelecimento: 'Posto', valor: 'R$ 200,00', data: '13/10/2026', banco: 'Caju' };

    const falhaRegistrada = await registrarFalha(chatId, dados, 'Caju', 'Erro 500');
    let falhas = await listarFalhas(chatId);
    expect(falhas.length).toBe(1);

    const removido = await removerFalha(chatId, falhaRegistrada.id);
    expect(removido).toBe(true);

    falhas = await listarFalhas(chatId);
    expect(falhas.length).toBe(0);
  });

  it('Fluxo: múltiplas falhas -> contagem correta', async () => {
    const chatId = 12345;
    const dadosBase = { estabelecimento: 'Padaria', valor: 'R$ 10,00', data: '14/10/2026', banco: 'Nubank' };

    await registrarFalha(chatId, dadosBase, 'Nubank', 'Erro 1');
    await registrarFalha(chatId, dadosBase, 'Nubank', 'Erro 2');
    await registrarFalha(chatId, dadosBase, 'Nubank', 'Erro 3');

    const total = await contarFalhas(chatId);
    expect(total).toBe(3);
  });
});
