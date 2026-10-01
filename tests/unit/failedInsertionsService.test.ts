jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

import { registrarFalha, listarFalhas, removerFalha, contarFalhas, getFailedInsertionsFilePath, gerarIdFalha } from '../../src/services/failedInsertionsService';

describe('failedInsertionsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  describe('gerarIdFalha', () => {
    it('deve gerar IDs únicos', () => {
      const id1 = gerarIdFalha();
      const id2 = gerarIdFalha();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });
  });

  describe('getFailedInsertionsFilePath', () => {
    it('deve retornar caminho contendo chatId e .json', () => {
      const chatId = 12345;
      const result = getFailedInsertionsFilePath(chatId);
      expect(result).toContain(String(chatId));
      expect(result).toContain('.json');
    });
  });

  describe('registrarFalha', () => {
    const chatId = 111;
    const dados = { estabelecimento: 'Loja', valor: '50.00', data: '2023-10-01', banco: 'Nubank' };
    const bancoSelecionado = 'Nubank';
    const erro = 'Erro de timeout';

    it('registra falha com todos os campos corretos', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [] }));
      
      const result = await registrarFalha(chatId, dados, bancoSelecionado, erro);
      
      expect(result.estabelecimento).toBe(dados.estabelecimento);
      expect(result.erro).toBe(erro);
      expect(result.id).toBeDefined();
      expect(result.falhouEm).toBeDefined();
    });

    it('adiciona a um store existente', async () => {
      const falhaExistente = { id: 'old-1', estabelecimento: 'Old', valor: '10', data: '2023-10-01', banco: null, bancoSelecionado: 'Itau', falhouEm: '2023', erro: 'e' };
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [falhaExistente] }));
      
      await registrarFalha(chatId, dados, bancoSelecionado, erro);
      
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writeCallArg = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(writeCallArg.falhas).toHaveLength(2);
      expect(writeCallArg.falhas[0].id).toBe('old-1');
    });

    it('cria arquivo novo quando não existe', async () => {
      const erroEnoent = new Error('ENOENT') as any;
      erroEnoent.code = 'ENOENT';
      mockReadFile.mockRejectedValue(erroEnoent);
      
      await registrarFalha(chatId, dados, bancoSelecionado, erro);
      
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writeCallArg = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(writeCallArg.falhas).toHaveLength(1);
    });
  });

  describe('listarFalhas', () => {
    const chatId = 222;

    it('retorna lista de falhas', async () => {
      const falhasMock = [{ id: '1', estabelecimento: 'X' }];
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: falhasMock }));
      
      const result = await listarFalhas(chatId);
      expect(result).toEqual(falhasMock);
    });

    it('retorna array vazio quando arquivo não existe', async () => {
      const erroEnoent = new Error('ENOENT') as any;
      erroEnoent.code = 'ENOENT';
      mockReadFile.mockRejectedValue(erroEnoent);
      
      const result = await listarFalhas(chatId);
      expect(result).toEqual([]);
    });
  });

  describe('removerFalha', () => {
    const chatId = 333;
    const falhaExistente = { id: 'falha-1', estabelecimento: 'X' };

    it('remove falha existente, retorna true', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [falhaExistente] }));
      
      const result = await removerFalha(chatId, 'falha-1');
      expect(result).toBe(true);
      
      const writeCallArg = JSON.parse(mockWriteFile.mock.calls[0][1]);
      expect(writeCallArg.falhas).toHaveLength(0);
    });

    it('retorna false para falha inexistente', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [falhaExistente] }));
      
      const result = await removerFalha(chatId, 'falha-2');
      expect(result).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('contarFalhas', () => {
    const chatId = 444;

    it('retorna contagem correta', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [{}, {}, {}] }));
      
      const result = await contarFalhas(chatId);
      expect(result).toBe(3);
    });

    it('retorna 0 quando arquivo não existe', async () => {
      const erroEnoent = new Error('ENOENT') as any;
      erroEnoent.code = 'ENOENT';
      mockReadFile.mockRejectedValue(erroEnoent);
      
      const result = await contarFalhas(chatId);
      expect(result).toBe(0);
    });
  });
});
