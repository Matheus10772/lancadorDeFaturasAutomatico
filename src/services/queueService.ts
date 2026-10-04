import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import cron, { type ScheduledTask } from 'node-cron';

dotenv.config();

// --- Interfaces ---

type OrigemItem = 'macrodroid' | 'reprocess' | 'falha' | 'manual';

interface QueueItem {
	id: string;
	texto: string;
	banco: string;
	origem: OrigemItem;
	adicionadoEm: string;
	// Para itens vindos de falhas: dados já processados (não precisa reprocessar o texto)
	dadosProcessados?: {
		estabelecimento: string;
		valor: string;
		data: string;
		banco: string | null;
	};
	// ID da FailedInsertion vinculada (para remover do arquivo de falhas após sucesso/descarte)
	falhaId?: string;
}

/** Item a ser adicionado na fila. `id` e `adicionadoEm` são gerados se não informados. */
type NovoQueueItem = Omit<QueueItem, 'id' | 'adicionadoEm'> & Partial<Pick<QueueItem, 'id' | 'adicionadoEm'>>;

interface QueueStore {
	itens: QueueItem[];
}

// --- Armazenamento em memória ---

const filas: Map<number, QueueItem[]> = new Map();

// --- Controle de persistência ---
// A fila vive em memória e é gravada em disco periodicamente (cron) ou via /savenow.
// Só grava quando lastQueueModified mudou desde a última gravação.

/** Momento da última alteração em qualquer fila (estritamente crescente). */
let lastQueueModified: Date = new Date(0);
/** Valor de lastQueueModified que já está refletido no disco. */
let lastQueueSaved: Date = new Date(0);
/** Serializa as gravações (cron e /savenow não escrevem ao mesmo tempo). */
let gravacaoEmAndamento: Promise<unknown> = Promise.resolve();

const EXPRESSAO_CRON_PADRAO = '*/5 * * * *'; // a cada 5 minutos

function marcarFilaModificada(): void {
	// Garante que o valor sempre muda, mesmo com duas alterações no mesmo milissegundo
	lastQueueModified = new Date(Math.max(Date.now(), lastQueueModified.getTime() + 1));
}

function getLastQueueModified(): Date {
	return lastQueueModified;
}

function getLastQueueSaved(): Date {
	return lastQueueSaved;
}

function haAlteracoesNaoSalvas(): boolean {
	return lastQueueModified.getTime() !== lastQueueSaved.getTime();
}

// --- Caminho do arquivo ---

function getQueueDir(): string {
	const initDir = process.env.INIT_DIR ?? '';
	return path.join(os.homedir(), initDir, 'queue');
}

function getQueueFilePath(chatId: number): string {
	return path.join(getQueueDir(), `${chatId}.json`);
}

// --- Leitura e escrita do arquivo ---

async function lerQueueStore(chatId: number): Promise<QueueStore> {
	try {
		const conteudo = await fs.readFile(getQueueFilePath(chatId), 'utf-8');
		return JSON.parse(conteudo) as QueueStore;
	} catch (error: any) {
		if (error.code === 'ENOENT') {
			return { itens: [] };
		}
		throw error;
	}
}

/** Escreve em arquivo temporário e renomeia, para nunca deixar um JSON pela metade. */
async function escreverQueueStore(chatId: number, store: QueueStore): Promise<void> {
	const filePath = getQueueFilePath(chatId);
	const tmpPath = `${filePath}.tmp`;
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
	await fs.rename(tmpPath, filePath);
}

// --- Funções públicas ---

/**
 * Gera um ID único para cada item da fila.
 */
function gerarIdQueue(): string {
	return `q-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Retorna a fila em memória de um chat (cria se não existir).
 */
function obterFila(chatId: number): QueueItem[] {
	let fila = filas.get(chatId);
	if (!fila) {
		fila = [];
		filas.set(chatId, fila);
	}
	return fila;
}

/**
 * Dois itens são o mesmo quando:
 * 1. têm o mesmo ID de origem (ex.: falha recarregada do item que a gerou); ou
 * 2. têm o mesmo falhaId; ou
 * 3. nenhum tem falhaId e ambos têm o mesmo texto + banco.
 *
 * Compras idênticas legítimas vindas de falhas distintas NÃO são consideradas duplicatas.
 */
function mesmoItem(a: NovoQueueItem, b: NovoQueueItem): boolean {
	if (a.id && b.id && a.id === b.id) return true;
	if (a.falhaId || b.falhaId) {
		return a.falhaId === b.falhaId;
	}
	return a.texto === b.texto && a.banco === b.banco;
}

/**
 * Verifica se um item equivalente já está na fila do chat.
 */
function isDuplicata(chatId: number, item: NovoQueueItem): boolean {
	return obterFila(chatId).some(existente => mesmoItem(existente, item));
}

/**
 * Adiciona itens no fim da fila, ignorando duplicatas.
 * @returns Quantidade de itens efetivamente adicionados
 */
function adicionarItensNaFila(chatId: number, itens: NovoQueueItem[]): number {
	const fila = obterFila(chatId);
	let adicionados = 0;

	for (const item of itens) {
		if (isDuplicata(chatId, item)) continue;

		fila.push({
			...item,
			id: item.id ?? gerarIdQueue(),
			adicionadoEm: item.adicionadoEm ?? new Date().toISOString(),
		});
		adicionados++;
	}

	if (adicionados > 0) marcarFilaModificada();
	return adicionados;
}

/**
 * Retorna o primeiro item da fila SEM removê-lo.
 */
function proximoItem(chatId: number): QueueItem | null {
	return filas.get(chatId)?.[0] ?? null;
}

/**
 * Remove e retorna o primeiro item da fila.
 */
function removerPrimeiroItem(chatId: number): QueueItem | null {
	const item = filas.get(chatId)?.shift() ?? null;
	if (item) marcarFilaModificada();
	return item;
}

/**
 * Atualiza campos do primeiro item da fila (ex.: vincular falhaId ou dados editados).
 * @returns O item atualizado, ou null se a fila estiver vazia
 */
function atualizarPrimeiroItem(
	chatId: number,
	alteracoes: Partial<Pick<QueueItem, 'dadosProcessados' | 'falhaId'>>,
): QueueItem | null {
	const fila = filas.get(chatId);
	if (!fila || fila.length === 0) return null;

	fila[0] = { ...fila[0], ...alteracoes };
	marcarFilaModificada();
	return fila[0];
}

/**
 * Conta os itens na fila em memória.
 */
function contarItens(chatId: number): number {
	return filas.get(chatId)?.length ?? 0;
}

/**
 * Limpa a fila em memória de um chat.
 * A fila vazia continua registrada para que a próxima gravação sobrescreva o arquivo.
 */
function limparFila(chatId: number): void {
	const fila = filas.get(chatId);
	if (!fila || fila.length === 0) return;
	filas.set(chatId, []);
	marcarFilaModificada();
}

/**
 * Sobrescreve os arquivos em disco com o estado atual de todas as filas em memória.
 * Gravações concorrentes (cron + /savenow) são serializadas.
 * @returns Total de itens gravados (somando todos os chats)
 */
function salvarFilasEmDisco(): Promise<number> {
	const gravacao = gravacaoEmAndamento.then(async () => {
		// Captura o marcador ANTES de gravar: se a fila mudar durante a escrita,
		// a próxima verificação ainda verá diferença e gravará de novo.
		const marcador = lastQueueModified;
		let total = 0;

		for (const [chatId, fila] of filas) {
			await escreverQueueStore(chatId, { itens: [...fila] });
			total += fila.length;
		}

		lastQueueSaved = marcador;
		return total;
	});

	// Uma falha não pode travar as gravações seguintes
	gravacaoEmAndamento = gravacao.catch(() => undefined);
	return gravacao;
}

/**
 * Grava as filas em disco somente se houve alteração desde a última gravação.
 * @returns true se gravou, false se não havia nada novo
 */
async function salvarSeModificada(): Promise<boolean> {
	if (!haAlteracoesNaoSalvas()) return false;
	await salvarFilasEmDisco();
	return true;
}

/**
 * Restaura as filas salvas em disco para a memória (usado na inicialização).
 * O arquivo é mantido, pois continua sendo o snapshot da fila.
 * @returns Quantidade de itens restaurados
 */
async function carregarFilasDoDisco(): Promise<number> {
	let arquivos: string[];
	try {
		arquivos = await fs.readdir(getQueueDir());
	} catch (error: any) {
		if (error.code === 'ENOENT') return 0;
		throw error;
	}

	let restaurados = 0;
	for (const arquivo of arquivos) {
		const match = arquivo.match(/^(-?\d+)\.json$/);
		if (!match) continue;

		const chatId = Number(match[1]);
		const store = await lerQueueStore(chatId);
		restaurados += adicionarItensNaFila(chatId, store.itens ?? []);
	}

	// O que acabou de ser lido já está em disco: nada a gravar
	lastQueueSaved = lastQueueModified;
	return restaurados;
}

/**
 * Agenda a gravação periódica das filas (padrão: a cada 5 minutos).
 * Em cada execução, só grava se lastQueueModified mudou.
 */
function iniciarPersistenciaPeriodica(expressao: string = EXPRESSAO_CRON_PADRAO): ScheduledTask {
	return cron.schedule(expressao, async () => {
		try {
			if (await salvarSeModificada()) {
				console.log(`[fila] Filas gravadas em disco (modificadas em ${lastQueueModified.toISOString()}).`);
			}
		} catch (error) {
			console.error('[fila] Erro ao gravar filas em disco:', error);
		}
	}, {
		name: 'persistir-fila',
		noOverlap: true, // não inicia uma verificação enquanto a anterior ainda está gravando
	});
}

export {
	obterFila,
	isDuplicata,
	adicionarItensNaFila,
	proximoItem,
	removerPrimeiroItem,
	atualizarPrimeiroItem,
	contarItens,
	limparFila,
	salvarFilasEmDisco,
	salvarSeModificada,
	carregarFilasDoDisco,
	iniciarPersistenciaPeriodica,
	haAlteracoesNaoSalvas,
	getLastQueueModified,
	getLastQueueSaved,
	gerarIdQueue,
	getQueueDir,
	getQueueFilePath,
	filas,
};
export type { QueueItem, NovoQueueItem, OrigemItem };
