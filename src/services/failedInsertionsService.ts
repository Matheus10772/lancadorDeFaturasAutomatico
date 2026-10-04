import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

// --- Interfaces ---

interface FailedInsertion {
	id: string;
	estabelecimento: string;
	valor: string;
	data: string;
	banco: string | null;
	bancoSelecionado: string;
	falhouEm: string;
	erro: string;
	// ID do item da fila que gerou a falha (garante uma única falha por item)
	origemId?: string;
}

interface FailedInsertionsStore {
	falhas: FailedInsertion[];
}

// --- Caminho do arquivo ---

function getFailedInsertionsDir(): string {
	const initDir = process.env.INIT_DIR ?? '';
	return path.join(os.homedir(), initDir, 'failed_insertions');
}

function getFailedInsertionsFilePath(chatId: number): string {
	return path.join(getFailedInsertionsDir(), `${chatId}.json`);
}

// --- Leitura e escrita do arquivo ---

async function lerFalhasStore(chatId: number): Promise<FailedInsertionsStore> {
	const filePath = getFailedInsertionsFilePath(chatId);
	try {
		const conteudo = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(conteudo) as FailedInsertionsStore;
	} catch (error: any) {
		if (error.code === 'ENOENT') {
			return { falhas: [] };
		}
		throw error;
	}
}

async function salvarFalhasStore(chatId: number, store: FailedInsertionsStore): Promise<void> {
	const filePath = getFailedInsertionsFilePath(chatId);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

// --- Funções públicas ---

/**
 * Gera um ID único para cada inserção falhada.
 */
function gerarIdFalha(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Registra uma inserção que falhou no arquivo JSON do chat.
 * Se `origemId` for informado e já existir uma falha desse item, ela é atualizada
 * (erro, data da falha, dados) em vez de criar outra — evita duplicatas por novas tentativas.
 */
async function registrarFalha(
	chatId: number,
	dados: { estabelecimento: string; valor: string; data: string; banco: string | null },
	bancoSelecionado: string,
	erro: string,
	origemId?: string,
): Promise<FailedInsertion> {
	const store = await lerFalhasStore(chatId);

	const existente = origemId ? store.falhas.find(f => f.origemId === origemId) : undefined;
	if (existente) {
		Object.assign(existente, {
			estabelecimento: dados.estabelecimento,
			valor: dados.valor,
			data: dados.data,
			banco: dados.banco,
			bancoSelecionado,
			falhouEm: new Date().toISOString(),
			erro,
		});
		await salvarFalhasStore(chatId, store);
		return existente;
	}

	const falha: FailedInsertion = {
		id: gerarIdFalha(),
		estabelecimento: dados.estabelecimento,
		valor: dados.valor,
		data: dados.data,
		banco: dados.banco,
		bancoSelecionado,
		falhouEm: new Date().toISOString(),
		erro,
		...(origemId ? { origemId } : {}),
	};

	store.falhas.push(falha);
	await salvarFalhasStore(chatId, store);

	return falha;
}

/**
 * Lista todas as inserções falhadas de um chat.
 */
async function listarFalhas(chatId: number): Promise<FailedInsertion[]> {
	const store = await lerFalhasStore(chatId);
	return store.falhas;
}

/**
 * Remove uma inserção falhada pelo ID.
 */
async function removerFalha(chatId: number, falhaId: string): Promise<boolean> {
	const store = await lerFalhasStore(chatId);
	const tamanhoAnterior = store.falhas.length;
	store.falhas = store.falhas.filter(f => f.id !== falhaId);

	if (store.falhas.length === tamanhoAnterior) {
		return false;
	}

	await salvarFalhasStore(chatId, store);
	return true;
}

/**
 * Remove as falhas ligadas a um item da fila: pelo próprio falhaId e/ou pelo ID de origem.
 * Cobre o caso em que o item da fila ainda não tinha o falhaId vinculado (ex.: fila restaurada
 * de um snapshot anterior ao erro).
 * @returns Quantidade de falhas removidas
 */
async function removerFalhasDoItem(chatId: number, item: { falhaId?: string; origemId?: string }): Promise<number> {
	if (!item.falhaId && !item.origemId) return 0;

	const store = await lerFalhasStore(chatId);
	const tamanhoAnterior = store.falhas.length;
	store.falhas = store.falhas.filter(f =>
		!(item.falhaId && f.id === item.falhaId) &&
		!(item.origemId && f.origemId === item.origemId)
	);

	const removidas = tamanhoAnterior - store.falhas.length;
	if (removidas > 0) {
		await salvarFalhasStore(chatId, store);
	}
	return removidas;
}

/**
 * Retorna a contagem de falhas pendentes.
 */
async function contarFalhas(chatId: number): Promise<number> {
	const store = await lerFalhasStore(chatId);
	return store.falhas.length;
}

export {
	registrarFalha,
	listarFalhas,
	removerFalha,
	removerFalhasDoItem,
	contarFalhas,
	getFailedInsertionsDir,
	getFailedInsertionsFilePath,
	gerarIdFalha,
};
export type { FailedInsertion, FailedInsertionsStore };

