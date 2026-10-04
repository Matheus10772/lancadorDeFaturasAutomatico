jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();
const mockUnlink = jest.fn();
const mockRename = jest.fn();
const mockReaddir = jest.fn();
jest.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  writeFile: (...args: any[]) => mockWriteFile(...args),
  mkdir: (...args: any[]) => mockMkdir(...args),
  unlink: (...args: any[]) => mockUnlink(...args),
  rename: (...args: any[]) => mockRename(...args),
  readdir: (...args: any[]) => mockReaddir(...args),
}));

const mockSchedule = jest.fn();
jest.mock('node-cron', () => ({
  schedule: (...args: any[]) => mockSchedule(...args),
}));

import {
  gerarIdQueue,
  getQueueFilePath,
  adicionarItensNaFila,
  proximoItem,
  removerPrimeiroItem,
  atualizarPrimeiroItem,
  contarItens,
  salvarFilasEmDisco,
  salvarSeModificada,
  carregarFilasDoDisco,
  iniciarPersistenciaPeriodica,
  haAlteracoesNaoSalvas,
  getLastQueueModified,
  getLastQueueSaved,
  limparFila,
  isDuplicata,
  obterFila,
} from '../../src/services/queueService';
import type { NovoQueueItem } from '../../src/services/queueService';

const CHAT_ID = 123;

const item = (texto: string, banco = 'Nubank', extra: Partial<NovoQueueItem> = {}): NovoQueueItem => ({
  texto,
  banco,
  origem: 'macrodroid',
  ...extra,
});

describe('queueService', () => {
  beforeEach(async () => {
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockMkdir.mockReset().mockResolvedValue(undefined);
    mockUnlink.mockReset().mockResolvedValue(undefined);
    mockRename.mockReset().mockResolvedValue(undefined);
    mockReaddir.mockReset().mockResolvedValue([]);
    mockReadFile.mockReset().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    // Estado limpo e sincronizado com o "disco" antes de cada teste
    limparFila(CHAT_ID);
    limparFila(999);
    await salvarFilasEmDisco();
    jest.clearAllMocks();
  });

  describe('gerarIdQueue', () => {
    it('deve gerar IDs únicos', () => {
      const ids = new Set(Array.from({ length: 50 }, () => gerarIdQueue()));
      expect(ids.size).toBe(50);
    });

    it('deve gerar IDs com prefixo "q-"', () => {
      expect(gerarIdQueue()).toMatch(/^q-/);
    });
  });

  describe('getQueueFilePath', () => {
    it('deve retornar um path com o chatId e extensão .json dentro de "queue"', () => {
      const p = getQueueFilePath(CHAT_ID);
      expect(p).toContain('queue');
      expect(p.endsWith(`${CHAT_ID}.json`)).toBe(true);
    });
  });

  describe('adicionarItensNaFila', () => {
    it('deve adicionar itens e retornar a contagem correta', () => {
      const adicionados = adicionarItensNaFila(CHAT_ID, [item('a'), item('b'), item('c')]);
      expect(adicionados).toBe(3);
      expect(contarItens(CHAT_ID)).toBe(3);
    });

    it('deve preencher id e adicionadoEm', () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      const [adicionado] = obterFila(CHAT_ID);
      expect(adicionado.id).toBeTruthy();
      expect(new Date(adicionado.adicionadoEm).toString()).not.toBe('Invalid Date');
    });

    it('deve ignorar duplicatas (mesmo texto + banco)', () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      const adicionados = adicionarItensNaFila(CHAT_ID, [item('a'), item('b')]);
      expect(adicionados).toBe(1);
      expect(contarItens(CHAT_ID)).toBe(2);
    });

    it('deve ignorar duplicatas dentro do mesmo lote', () => {
      expect(adicionarItensNaFila(CHAT_ID, [item('a'), item('a')])).toBe(1);
    });

    it('não deve considerar duplicata o mesmo texto com banco diferente', () => {
      expect(adicionarItensNaFila(CHAT_ID, [item('a', 'Nubank'), item('a', 'Itaú')])).toBe(2);
    });

    it('deve deduplicar itens de falha pelo falhaId, não pelo texto', () => {
      const adicionados = adicionarItensNaFila(CHAT_ID, [
        item('Padaria R$ 10,00', 'Nubank', { origem: 'falha', falhaId: 'f1' }),
        item('Padaria R$ 10,00', 'Nubank', { origem: 'falha', falhaId: 'f2' }),
        item('Padaria R$ 10,00', 'Nubank', { origem: 'falha', falhaId: 'f1' }),
      ]);
      expect(adicionados).toBe(2);
    });
  });

  describe('isDuplicata', () => {
    it('deve retornar false para fila vazia e true após adicionar', () => {
      expect(isDuplicata(CHAT_ID, item('a'))).toBe(false);
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      expect(isDuplicata(CHAT_ID, item('a'))).toBe(true);
    });
  });

  describe('proximoItem (peek)', () => {
    it('deve retornar o primeiro item sem removê-lo', () => {
      adicionarItensNaFila(CHAT_ID, [item('a'), item('b')]);
      expect(proximoItem(CHAT_ID)?.texto).toBe('a');
      expect(contarItens(CHAT_ID)).toBe(2);
    });

    it('deve retornar null quando a fila está vazia', () => {
      expect(proximoItem(CHAT_ID)).toBeNull();
    });
  });

  describe('removerPrimeiroItem (pop)', () => {
    it('deve remover e retornar o primeiro item', () => {
      adicionarItensNaFila(CHAT_ID, [item('a'), item('b')]);
      expect(removerPrimeiroItem(CHAT_ID)?.texto).toBe('a');
      expect(contarItens(CHAT_ID)).toBe(1);
      expect(proximoItem(CHAT_ID)?.texto).toBe('b');
    });

    it('deve retornar null quando a fila está vazia', () => {
      expect(removerPrimeiroItem(CHAT_ID)).toBeNull();
    });
  });

  describe('atualizarPrimeiroItem', () => {
    it('deve atualizar apenas o primeiro item, preservando os demais campos', () => {
      adicionarItensNaFila(CHAT_ID, [item('a'), item('b')]);
      const dadosProcessados = { estabelecimento: 'Loja', valor: 'R$ 1,00', data: '01/10/2026', banco: null };

      const atualizado = atualizarPrimeiroItem(CHAT_ID, { falhaId: 'f1', dadosProcessados });

      expect(atualizado).toMatchObject({ texto: 'a', falhaId: 'f1', dadosProcessados });
      expect(proximoItem(CHAT_ID)).toMatchObject({ texto: 'a', falhaId: 'f1' });
      expect(obterFila(CHAT_ID)[1].falhaId).toBeUndefined();
      expect(contarItens(CHAT_ID)).toBe(2);
    });

    it('deve retornar null quando a fila está vazia', () => {
      expect(atualizarPrimeiroItem(CHAT_ID, { falhaId: 'f1' })).toBeNull();
    });
  });

  describe('contarItens', () => {
    it('deve contar 0 para chat sem fila e N após adicionar', () => {
      expect(contarItens(CHAT_ID)).toBe(0);
      adicionarItensNaFila(CHAT_ID, [item('a'), item('b')]);
      expect(contarItens(CHAT_ID)).toBe(2);
    });
  });

  describe('limparFila', () => {
    it('deve limpar a fila em memória', () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      limparFila(CHAT_ID);
      expect(contarItens(CHAT_ID)).toBe(0);
    });
  });

  describe('lastQueueModified', () => {
    it('deve mudar ao adicionar, remover, atualizar e limpar', () => {
      const etapas: Array<() => unknown> = [
        () => adicionarItensNaFila(CHAT_ID, [item('a'), item('b')]),
        () => removerPrimeiroItem(CHAT_ID),
        () => atualizarPrimeiroItem(CHAT_ID, { falhaId: 'f1' }),
        () => limparFila(CHAT_ID),
      ];

      for (const etapa of etapas) {
        const antes = getLastQueueModified().getTime();
        etapa();
        expect(getLastQueueModified().getTime()).toBeGreaterThan(antes);
      }
    });

    it('não deve mudar quando nada é alterado (duplicata, fila vazia)', () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      const antes = getLastQueueModified().getTime();

      adicionarItensNaFila(CHAT_ID, [item('a')]); // duplicata
      removerPrimeiroItem(999);                    // fila vazia
      atualizarPrimeiroItem(999, { falhaId: 'x' }); // fila vazia
      limparFila(999);                             // fila vazia

      expect(getLastQueueModified().getTime()).toBe(antes);
    });
  });

  describe('salvarFilasEmDisco', () => {
    it('deve sobrescrever o arquivo (tmp + rename) sem limpar a memória', async () => {
      adicionarItensNaFila(CHAT_ID, [item('a'), item('b')]);

      await salvarFilasEmDisco();

      const caminho = getQueueFilePath(CHAT_ID);
      const escrita = mockWriteFile.mock.calls.find(([p]) => p === `${caminho}.tmp`);
      expect(escrita).toBeDefined();
      expect(JSON.parse(escrita![1]).itens.map((i: any) => i.texto)).toEqual(['a', 'b']);
      expect(mockRename).toHaveBeenCalledWith(`${caminho}.tmp`, caminho);
      expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('queue'), { recursive: true });
      expect(contarItens(CHAT_ID)).toBe(2);
      expect(haAlteracoesNaoSalvas()).toBe(false);
      expect(getLastQueueSaved().getTime()).toBe(getLastQueueModified().getTime());
    });

    it('deve gravar a fila vazia depois de limparFila (para o item não "ressuscitar")', async () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      await salvarFilasEmDisco();
      limparFila(CHAT_ID);
      mockWriteFile.mockClear();

      await salvarFilasEmDisco();

      const escrita = mockWriteFile.mock.calls.find(([p]) => p === `${getQueueFilePath(CHAT_ID)}.tmp`);
      expect(JSON.parse(escrita![1]).itens).toEqual([]);
    });

    it('deve continuar com alterações pendentes se a fila mudar durante a gravação', async () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      mockWriteFile.mockImplementationOnce(async () => {
        adicionarItensNaFila(CHAT_ID, [item('chegou-durante-a-gravacao')]);
      });

      await salvarFilasEmDisco();

      expect(haAlteracoesNaoSalvas()).toBe(true);
    });

    it('deve propagar erro de escrita e manter as alterações como pendentes', async () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC'));

      await expect(salvarFilasEmDisco()).rejects.toThrow('ENOSPC');
      expect(haAlteracoesNaoSalvas()).toBe(true);

      // A falha não trava as próximas gravações
      await expect(salvarFilasEmDisco()).resolves.toBeGreaterThanOrEqual(1);
      expect(haAlteracoesNaoSalvas()).toBe(false);
    });
  });

  describe('salvarSeModificada', () => {
    it('não deve gravar quando lastQueueModified é igual ao da última gravação', async () => {
      expect(await salvarSeModificada()).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('deve gravar quando houve alteração, e só uma vez', async () => {
      adicionarItensNaFila(CHAT_ID, [item('a')]);

      expect(await salvarSeModificada()).toBe(true);
      expect(mockWriteFile).toHaveBeenCalled();

      mockWriteFile.mockClear();
      expect(await salvarSeModificada()).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('carregarFilasDoDisco', () => {
    it('deve restaurar os arquivos <chatId>.json, ignorar o resto e manter o arquivo', async () => {
      const salvo = [
        { id: 'q-1', texto: 'a', banco: 'Nubank', origem: 'reprocess', adicionadoEm: '2026-01-01T00:00:00.000Z' },
        { id: 'q-2', texto: 'b', banco: 'Itaú', origem: 'falha', adicionadoEm: '2026-01-02T00:00:00.000Z', falhaId: 'f1' },
      ];
      mockReaddir.mockResolvedValue([`${CHAT_ID}.json`, `${CHAT_ID}.json.tmp`, 'anotacoes.txt']);
      mockReadFile.mockResolvedValue(JSON.stringify({ itens: salvo }));

      const restaurados = await carregarFilasDoDisco();

      expect(restaurados).toBe(2);
      expect(mockReadFile).toHaveBeenCalledTimes(1);
      expect(proximoItem(CHAT_ID)).toMatchObject({ id: 'q-1', adicionadoEm: '2026-01-01T00:00:00.000Z' });
      expect(mockUnlink).not.toHaveBeenCalled();
      // O que veio do disco já está salvo: o cron não precisa regravar
      expect(haAlteracoesNaoSalvas()).toBe(false);
    });

    it('deve retornar 0 quando a pasta da fila não existe (ENOENT)', async () => {
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      expect(await carregarFilasDoDisco()).toBe(0);
    });

    it('deve propagar erros que não sejam ENOENT', async () => {
      mockReaddir.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
      await expect(carregarFilasDoDisco()).rejects.toThrow('EACCES');
    });
  });

  describe('iniciarPersistenciaPeriodica', () => {
    it('deve agendar a cada 5 minutos e só gravar quando a fila mudou', async () => {
      iniciarPersistenciaPeriodica();

      expect(mockSchedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function), expect.objectContaining({ noOverlap: true }));
      const tarefa = mockSchedule.mock.calls[0][1];

      await tarefa(); // nada mudou
      expect(mockWriteFile).not.toHaveBeenCalled();

      adicionarItensNaFila(CHAT_ID, [item('a')]);
      await tarefa(); // mudou
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('não deve lançar se a gravação falhar (apenas loga)', async () => {
      const erroLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      iniciarPersistenciaPeriodica();
      const tarefa = mockSchedule.mock.calls[0][1];
      adicionarItensNaFila(CHAT_ID, [item('a')]);
      mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC'));

      await expect(tarefa()).resolves.toBeUndefined();
      expect(erroLog).toHaveBeenCalled();
      erroLog.mockRestore();
    });
  });
});
