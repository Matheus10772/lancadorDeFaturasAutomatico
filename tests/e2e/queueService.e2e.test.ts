jest.mock('dotenv', () => ({ config: jest.fn() }));

// Sistema de arquivos em memória (path -> conteúdo), compartilhado entre "processos"
let arquivos: Map<string, string> = new Map();
jest.mock('fs/promises', () => {
  const path = require('path');
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    readFile: jest.fn(async (p: string) => {
      if (!arquivos.has(p)) throw enoent();
      return arquivos.get(p);
    }),
    writeFile: jest.fn(async (p: string, data: string) => { arquivos.set(p, data); }),
    mkdir: jest.fn(async () => undefined),
    rename: jest.fn(async (de: string, para: string) => {
      if (!arquivos.has(de)) throw enoent();
      arquivos.set(para, arquivos.get(de)!);
      arquivos.delete(de);
    }),
    readdir: jest.fn(async (dir: string) => {
      const nomes = [...arquivos.keys()].filter(p => path.dirname(p) === dir).map(p => path.basename(p));
      if (nomes.length === 0) throw enoent();
      return nomes;
    }),
    unlink: jest.fn(async (p: string) => { arquivos.delete(p); }),
  };
});

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

import type { NovoQueueItem } from '../../src/services/queueService';

type QueueModule = typeof import('../../src/services/queueService');

/** Carrega uma instância nova do módulo — simula o processo reiniciando (memória zerada). */
function novoProcesso(): QueueModule {
  let modulo!: QueueModule;
  jest.isolateModules(() => {
    modulo = require('../../src/services/queueService');
  });
  return modulo;
}

const item = (texto: string, banco = 'Nubank'): NovoQueueItem => ({ texto, banco, origem: 'reprocess' });

const textosDaFila = (q: QueueModule, chatId: number): string[] => q.obterFila(chatId).map(i => i.texto);

describe('E2E: queueService', () => {
  let q: QueueModule;

  beforeEach(() => {
    arquivos = new Map();
    q = novoProcesso();
  });

  it('Fluxo: adicionar -> peek -> pop -> fila vazia', () => {
    q.adicionarItensNaFila(1, [item('a'), item('b')]);

    expect(q.proximoItem(1)?.texto).toBe('a');
    expect(q.contarItens(1)).toBe(2);

    expect(q.removerPrimeiroItem(1)?.texto).toBe('a');
    expect(q.proximoItem(1)?.texto).toBe('b');

    expect(q.removerPrimeiroItem(1)?.texto).toBe('b');
    expect(q.proximoItem(1)).toBeNull();
    expect(q.contarItens(1)).toBe(0);
  });

  it('Fluxo: adicionar duplicatas -> contagem correta', () => {
    expect(q.adicionarItensNaFila(1, [item('a'), item('a'), item('b')])).toBe(2);
    expect(q.adicionarItensNaFila(1, [item('b'), item('c')])).toBe(1);
    expect(q.contarItens(1)).toBe(3);
  });

  it('Fluxo: 8 itens do reprocessamento sobrevivem a um reinício após a gravação', async () => {
    q.adicionarItensNaFila(1, Array.from({ length: 8 }, (_, i) => item(`item-${i + 1}`)));
    q.removerPrimeiroItem(1); // usuário tratou o primeiro

    expect(await q.salvarSeModificada()).toBe(true);

    // Recompilou / reiniciou
    const reiniciado = novoProcesso();
    expect(reiniciado.contarItens(1)).toBe(0);

    expect(await reiniciado.carregarFilasDoDisco()).toBe(7);
    expect(textosDaFila(reiniciado, 1)).toEqual(['item-2', 'item-3', 'item-4', 'item-5', 'item-6', 'item-7', 'item-8']);
  });

  it('Fluxo: alterações feitas depois da última gravação se perdem no reinício (até a próxima verificação)', async () => {
    q.adicionarItensNaFila(1, [item('a'), item('b')]);
    await q.salvarSeModificada();
    q.adicionarItensNaFila(1, [item('c')]); // ainda não gravado

    const reiniciado = novoProcesso();
    await reiniciado.carregarFilasDoDisco();

    expect(textosDaFila(reiniciado, 1)).toEqual(['a', 'b']);
  });

  it('Fluxo: o disco é sobrescrito com a fila atual (itens removidos não voltam)', async () => {
    q.adicionarItensNaFila(1, [item('a'), item('b'), item('c')]);
    await q.salvarSeModificada();

    q.removerPrimeiroItem(1);
    q.removerPrimeiroItem(1);
    await q.salvarSeModificada();

    const reiniciado = novoProcesso();
    await reiniciado.carregarFilasDoDisco();
    expect(textosDaFila(reiniciado, 1)).toEqual(['c']);
  });

  it('Fluxo: verificação periódica só grava quando lastQueueModified muda', async () => {
    const fs = require('fs/promises');

    q.adicionarItensNaFila(1, [item('a')]);
    expect(await q.salvarSeModificada()).toBe(true);
    const escritasAposPrimeira = fs.writeFile.mock.calls.length;

    expect(await q.salvarSeModificada()).toBe(false);
    expect(await q.salvarSeModificada()).toBe(false);
    expect(fs.writeFile.mock.calls.length).toBe(escritasAposPrimeira);

    q.adicionarItensNaFila(1, [item('b')]);
    expect(await q.salvarSeModificada()).toBe(true);
  });

  it('Fluxo: restaurar não duplica itens que já estão na memória', async () => {
    q.adicionarItensNaFila(1, [item('a'), item('b')]);
    await q.salvarFilasEmDisco();

    // Carregar de novo no mesmo processo: mesmos IDs, nada é duplicado
    expect(await q.carregarFilasDoDisco()).toBe(0);
    expect(q.contarItens(1)).toBe(2);
  });

  it('Fluxo: múltiplos chatIds independentes, cada um com seu arquivo', async () => {
    q.adicionarItensNaFila(1, [item('a'), item('b')]);
    q.adicionarItensNaFila(2, [item('a')]);
    q.removerPrimeiroItem(1);

    await q.salvarFilasEmDisco();
    expect(arquivos.has(q.getQueueFilePath(1))).toBe(true);
    expect(arquivos.has(q.getQueueFilePath(2))).toBe(true);

    const reiniciado = novoProcesso();
    expect(await reiniciado.carregarFilasDoDisco()).toBe(2);
    expect(textosDaFila(reiniciado, 1)).toEqual(['b']);
    expect(textosDaFila(reiniciado, 2)).toEqual(['a']);
    expect(reiniciado.contarItens(3)).toBe(0);
  });
});
