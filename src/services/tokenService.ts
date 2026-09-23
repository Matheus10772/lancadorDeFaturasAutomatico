import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

// --- Interfaces ---

interface TokenInfo {
	token: string;
	criadoEm: string;
	descricao: string;
}

interface TokenStore {
	tokens: TokenInfo[];
}

// --- Caminho do arquivo de tokens ---

function getTokenFilePath(): string {
	const initDir = process.env.INIT_DIR ?? '';
	return path.join(os.homedir(), initDir, 'tokens.json');
}

// --- Leitura e escrita do arquivo ---

async function lerTokenStore(): Promise<TokenStore> {
	const filePath = getTokenFilePath();
	try {
		const conteudo = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(conteudo) as TokenStore;
	} catch (error: any) {
		// Se o arquivo não existe, retorna store vazio
		if (error.code === 'ENOENT') {
			return { tokens: [] };
		}
		throw error;
	}
}

async function salvarTokenStore(store: TokenStore): Promise<void> {
	const filePath = getTokenFilePath();
	// Garante que o diretório existe
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

// --- Funções públicas ---

/**
 * Gera um novo token de API, salva no arquivo e retorna o token gerado.
 */
async function gerarToken(descricao: string = 'Token gerado via Telegram'): Promise<string> {
	const token = crypto.randomBytes(32).toString('hex');
	const store = await lerTokenStore();

	store.tokens.push({
		token,
		criadoEm: new Date().toISOString(),
		descricao,
	});

	await salvarTokenStore(store);
	return token;
}

/**
 * Verifica se um token existe no armazenamento.
 */
async function validarToken(token: string): Promise<boolean> {
	const store = await lerTokenStore();
	return store.tokens.some(t => t.token === token);
}

/**
 * Lista todos os tokens armazenados.
 */
async function listarTokens(): Promise<TokenInfo[]> {
	const store = await lerTokenStore();
	return store.tokens;
}

/**
 * Remove um token do armazenamento.
 * Retorna true se o token foi encontrado e removido, false caso contrário.
 */
async function revogarToken(token: string): Promise<boolean> {
	const store = await lerTokenStore();
	const tamanhoAnterior = store.tokens.length;
	store.tokens = store.tokens.filter(t => t.token !== token);

	if (store.tokens.length === tamanhoAnterior) {
		return false;
	}

	await salvarTokenStore(store);
	return true;
}

export {
	gerarToken,
	validarToken,
	listarTokens,
	revogarToken,
	getTokenFilePath,
};
export type { TokenInfo, TokenStore };

