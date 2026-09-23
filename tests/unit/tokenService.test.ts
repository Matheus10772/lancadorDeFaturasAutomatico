jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();
const mockMkdir = jest.fn();
jest.mock('fs/promises', () => ({
	readFile: (...args: any[]) => mockReadFile(...args),
	writeFile: (...args: any[]) => mockWriteFile(...args),
	mkdir: (...args: any[]) => mockMkdir(...args),
}));

import {
	gerarToken,
	validarToken,
	listarTokens,
	revogarToken,
	getTokenFilePath,
} from '../../src/services/tokenService';

describe('tokenService', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockReadFile.mockResolvedValue(JSON.stringify({ tokens: [] }));
		mockWriteFile.mockResolvedValue(undefined);
		mockMkdir.mockResolvedValue(undefined);
	});

	// --- gerarToken ---

	describe('gerarToken', () => {
		it('deve gerar um token hexadecimal de 64 caracteres', async () => {
			const token = await gerarToken();

			expect(token).toHaveLength(64);
			expect(token).toMatch(/^[0-9a-f]{64}$/);
		});

		it('deve salvar o token no arquivo JSON', async () => {
			const token = await gerarToken();

			expect(mockWriteFile).toHaveBeenCalledTimes(1);

			const conteudoSalvo = JSON.parse(mockWriteFile.mock.calls[0][1]);
			expect(conteudoSalvo.tokens).toHaveLength(1);
			expect(conteudoSalvo.tokens[0].token).toBe(token);
			expect(conteudoSalvo.tokens[0]).toHaveProperty('criadoEm');
			expect(conteudoSalvo.tokens[0].descricao).toBe('Token gerado via Telegram');
		});

		it('deve aceitar uma descrição customizada', async () => {
			const descricao = 'Meu token personalizado';
			const token = await gerarToken(descricao);

			const conteudoSalvo = JSON.parse(mockWriteFile.mock.calls[0][1]);
			expect(conteudoSalvo.tokens[0].descricao).toBe(descricao);
			expect(conteudoSalvo.tokens[0].token).toBe(token);
		});
	});

	// --- validarToken ---

	describe('validarToken', () => {
		it('deve retornar true para um token válido', async () => {
			const tokenExistente = 'a'.repeat(64);
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					tokens: [
						{
							token: tokenExistente,
							criadoEm: new Date().toISOString(),
							descricao: 'Token de teste',
						},
					],
				})
			);

			const resultado = await validarToken(tokenExistente);

			expect(resultado).toBe(true);
		});

		it('deve retornar false para um token inválido', async () => {
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					tokens: [
						{
							token: 'a'.repeat(64),
							criadoEm: new Date().toISOString(),
							descricao: 'Token de teste',
						},
					],
				})
			);

			const resultado = await validarToken('token_inexistente');

			expect(resultado).toBe(false);
		});

		it('deve retornar false quando o arquivo não existe (ENOENT)', async () => {
			const erro = new Error('ENOENT') as NodeJS.ErrnoException;
			erro.code = 'ENOENT';
			mockReadFile.mockRejectedValue(erro);

			const resultado = await validarToken('qualquer_token');

			expect(resultado).toBe(false);
		});
	});

	// --- listarTokens ---

	describe('listarTokens', () => {
		it('deve retornar a lista de tokens armazenados', async () => {
			const tokensExistentes = [
				{
					token: 'a'.repeat(64),
					criadoEm: '2026-01-01T00:00:00.000Z',
					descricao: 'Token 1',
				},
				{
					token: 'b'.repeat(64),
					criadoEm: '2026-01-02T00:00:00.000Z',
					descricao: 'Token 2',
				},
			];
			mockReadFile.mockResolvedValue(
				JSON.stringify({ tokens: tokensExistentes })
			);

			const resultado = await listarTokens();

			expect(resultado).toHaveLength(2);
			expect(resultado).toEqual(tokensExistentes);
		});

		it('deve retornar array vazio quando o arquivo não existe', async () => {
			const erro = new Error('ENOENT') as NodeJS.ErrnoException;
			erro.code = 'ENOENT';
			mockReadFile.mockRejectedValue(erro);

			const resultado = await listarTokens();

			expect(resultado).toEqual([]);
		});
	});

	// --- revogarToken ---

	describe('revogarToken', () => {
		it('deve remover um token existente e retornar true', async () => {
			const tokenParaRevogar = 'a'.repeat(64);
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					tokens: [
						{
							token: tokenParaRevogar,
							criadoEm: '2026-01-01T00:00:00.000Z',
							descricao: 'Token a remover',
						},
						{
							token: 'b'.repeat(64),
							criadoEm: '2026-01-02T00:00:00.000Z',
							descricao: 'Token a manter',
						},
					],
				})
			);

			const resultado = await revogarToken(tokenParaRevogar);

			expect(resultado).toBe(true);
			expect(mockWriteFile).toHaveBeenCalledTimes(1);

			const conteudoSalvo = JSON.parse(mockWriteFile.mock.calls[0][1]);
			expect(conteudoSalvo.tokens).toHaveLength(1);
			expect(conteudoSalvo.tokens[0].token).toBe('b'.repeat(64));
		});

		it('deve retornar false para um token inexistente', async () => {
			mockReadFile.mockResolvedValue(
				JSON.stringify({
					tokens: [
						{
							token: 'a'.repeat(64),
							criadoEm: '2026-01-01T00:00:00.000Z',
							descricao: 'Token existente',
						},
					],
				})
			);

			const resultado = await revogarToken('token_que_nao_existe');

			expect(resultado).toBe(false);
			expect(mockWriteFile).not.toHaveBeenCalled();
		});
	});

	// --- getTokenFilePath ---

	describe('getTokenFilePath', () => {
		it('deve retornar um caminho de arquivo válido', () => {
			const filePath = getTokenFilePath();

			expect(typeof filePath).toBe('string');
			expect(filePath).toContain('tokens.json');
		});
	});
});
