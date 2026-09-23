// =============================================
// Mocks — devem vir ANTES dos imports do módulo
// =============================================

process.env.TELEGRAM_CHAT_ID = '123456';

jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockSendMessage = jest.fn().mockResolvedValue({});
jest.mock('telegraf', () => ({
	Telegraf: jest.fn().mockImplementation(() => ({
		use: jest.fn(),
		command: jest.fn(),
		on: jest.fn(),
		action: jest.fn(),
		launch: jest.fn(),
		telegram: { sendMessage: mockSendMessage },
	})),
	Markup: {
		inlineKeyboard: jest.fn(() => ({})),
		button: { callback: jest.fn(() => ({})) },
	},
	session: jest.fn(() => jest.fn()),
}));

jest.mock('telegraf/filters', () => ({
	message: jest.fn((type: string) => `message:${type}`),
}));

jest.mock('../../src/services/googleSheetsComunicationService', () => ({
	GoogleSheetsComunicationService: jest.fn().mockImplementation(() => ({
		inserirInformacoesPlanilha: jest.fn().mockResolvedValue(undefined),
	})),
}));

// Mock do tokenService com armazenamento em memória
let tokensEmMemoria: string[] = [];
jest.mock('../../src/services/tokenService', () => ({
	gerarToken: jest.fn().mockImplementation(async () => {
		const crypto = require('crypto');
		const token = crypto.randomBytes(32).toString('hex');
		tokensEmMemoria.push(token);
		return token;
	}),
	validarToken: jest.fn().mockImplementation(async (token: string) => {
		return tokensEmMemoria.includes(token);
	}),
	revogarToken: jest.fn().mockImplementation(async (token: string) => {
		const idx = tokensEmMemoria.indexOf(token);
		if (idx >= 0) {
			tokensEmMemoria.splice(idx, 1);
			return true;
		}
		return false;
	}),
	getTokenFilePath: jest.fn().mockReturnValue('/tmp/tokens.json'),
}));

// =============================================
// Imports — após todos os mocks
// =============================================

import request from 'supertest';
import { app } from '../../src/services/receiveText';
import { gerarToken, revogarToken } from '../../src/services/tokenService';

// =============================================
// Testes E2E
// =============================================

describe('E2E — receiveText (/webhook-macrodroid)', () => {
	beforeEach(() => {
		tokensEmMemoria = [];
		jest.clearAllMocks();
	});

	// --------------------------------------------------
	// 1. Fluxo completo: gerar token → enviar notificação válida
	// --------------------------------------------------
	it('deve gerar token, enviar notificação válida e retornar 200 com dados extraídos', async () => {
		const token = await gerarToken();

		const res = await request(app)
			.post('/webhook-macrodroid')
			.set('Authorization', `Bearer ${token}`)
			.send({
				texto: 'Compra aprovada no Nubank - R$ 42,90 em Padaria Bom Pão 22/09/2026',
			});

		expect(res.status).toBe(200);
		expect(res.body).toHaveProperty('mensagem');
		expect(res.body.dados).toEqual(
			expect.objectContaining({
				valor: expect.stringContaining('42,90'),
				data: expect.stringContaining('22/09'),
			}),
		);
		expect(res.body.dados.estabelecimento).toBeDefined();
		expect(mockSendMessage).toHaveBeenCalled();
	});

	// --------------------------------------------------
	// 2. Fluxo: gerar token → revogar → tentar usar
	// --------------------------------------------------
	it('deve retornar 401 ao usar um token revogado', async () => {
		const token = await gerarToken();
		await revogarToken(token);

		const res = await request(app)
			.post('/webhook-macrodroid')
			.set('Authorization', `Bearer ${token}`)
			.send({
				texto: 'Compra aprovada no Nubank - R$ 15,00 em Loja XYZ 22/09/2026',
			});

		expect(res.status).toBe(401);
		expect(res.body).toHaveProperty('erro');
	});

	// --------------------------------------------------
	// 3. Fluxo: múltiplas notificações sequenciais com mesmo token
	// --------------------------------------------------
	it('deve aceitar múltiplas notificações sequenciais com o mesmo token', async () => {
		const token = await gerarToken();

		const notificacoes = [
			'Compra aprovada no Nubank - R$ 10,00 em Mercado Central 22/09/2026',
			'Compra aprovada no Itaú - R$ 55,50 em Farmácia Saúde 22/09/2026',
			'Compra aprovada no Caju - R$ 120,00 em Restaurante Bom Sabor 22/09/2026',
		];

		for (const texto of notificacoes) {
			const res = await request(app)
				.post('/webhook-macrodroid')
				.set('Authorization', `Bearer ${token}`)
				.send({ texto });

			expect(res.status).toBe(200);
			expect(res.body).toHaveProperty('mensagem');
			expect(res.body).toHaveProperty('dados');
		}
	});

	// --------------------------------------------------
	// 4. Fluxo: texto sem dados processáveis
	// --------------------------------------------------
	it('deve retornar 422 quando o texto não contém dados processáveis', async () => {
		const token = await gerarToken();

		const res = await request(app)
			.post('/webhook-macrodroid')
			.set('Authorization', `Bearer ${token}`)
			.send({
				texto: 'Mensagem aleatória sem informações de compra',
			});

		expect(res.status).toBe(422);
		expect(res.body).toHaveProperty('erro');
		expect(res.body.erro).toContain('Não foi possível extrair');
	});

	// --------------------------------------------------
	// 5. Fluxo: sem autenticação
	// --------------------------------------------------
	it('deve retornar 401 quando nenhum header de autorização é fornecido', async () => {
		const res = await request(app)
			.post('/webhook-macrodroid')
			.send({
				texto: 'Compra aprovada no Nubank - R$ 30,00 em Loja ABC 22/09/2026',
			});

		expect(res.status).toBe(401);
		expect(res.body).toHaveProperty('erro');
		expect(res.body.erro).toContain('Token de autenticação não fornecido');
	});
});
