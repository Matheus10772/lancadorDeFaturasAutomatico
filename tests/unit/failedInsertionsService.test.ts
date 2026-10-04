jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
}));

import { registrarFalha, listarFalhas, removerFalha, removerFalhasDoItem, contarFalhas, getFailedInsertionsFilePath, gerarIdFalha } from '../../src/services/failedInsertionsService';

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

  describe('registrarFalha com origemId (idempotência)', () => {
    const chatId = 112;
    const dados = { estabelecimento: 'Padaria', valor: 'R$ 10,00', data: '03/10/2026', banco: 'Nubank' };

    it('grava o origemId na falha nova', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [] }));

      const result = await registrarFalha(chatId, dados, 'Nubank', 'erro 1', 'q-item-1');

      expect(result.origemId).toBe('q-item-1');
      expect(JSON.parse(mockWriteFile.mock.calls[0][1]).falhas).toHaveLength(1);
    });

    it('não cria outra falha para o mesmo item: atualiza a existente', async () => {
      const existente = { id: 'f-1', ...dados, bancoSelecionado: 'Nubank', falhouEm: '2026-10-03T10:00:00.000Z', erro: 'erro 1', origemId: 'q-item-1' };
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [existente] }));

      const result = await registrarFalha(chatId, dados, 'Nubank', 'erro 2', 'q-item-1');

      expect(result.id).toBe('f-1');
      const gravado = JSON.parse(mockWriteFile.mock.calls[0][1]).falhas;
      expect(gravado).toHaveLength(1);
      expect(gravado[0].erro).toBe('erro 2');
    });

    it('compras idênticas de itens diferentes continuam sendo falhas distintas', async () => {
      const existente = { id: 'f-1', ...dados, bancoSelecionado: 'Nubank', falhouEm: '2026', erro: 'e', origemId: 'q-item-1' };
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas: [existente] }));

      const result = await registrarFalha(chatId, dados, 'Nubank', 'e', 'q-item-2');

      expect(result.id).not.toBe('f-1');
      expect(JSON.parse(mockWriteFile.mock.calls[0][1]).falhas).toHaveLength(2);
    });
  });

  describe('removerFalhasDoItem', () => {
    const chatId = 334;
    const falhas = [
      { id: 'f-1', estabelecimento: 'A', origemId: 'q-1' },
      { id: 'f-2', estabelecimento: 'B', origemId: 'q-2' },
      { id: 'f-3', estabelecimento: 'C' },
    ];

    it('remove pela origem mesmo sem falhaId', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas }));

      expect(await removerFalhasDoItem(chatId, { origemId: 'q-2' })).toBe(1);
      const ids = JSON.parse(mockWriteFile.mock.calls[0][1]).falhas.map((f: any) => f.id);
      expect(ids).toEqual(['f-1', 'f-3']);
    });

    it('remove pelo falhaId (falhas antigas, sem origemId)', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas }));

      expect(await removerFalhasDoItem(chatId, { falhaId: 'f-3', origemId: 'q-x' })).toBe(1);
    });

    it('não grava nada quando não há falha ligada ao item', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ falhas }));

      expect(await removerFalhasDoItem(chatId, { origemId: 'q-inexistente' })).toBe(0);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('retorna 0 sem ler o arquivo quando não há falhaId nem origemId', async () => {
      expect(await removerFalhasDoItem(chatId, {})).toBe(0);
      expect(mockReadFile).not.toHaveBeenCalled();
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
