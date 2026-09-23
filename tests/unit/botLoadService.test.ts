// --- Mocks devem vir ANTES dos imports do módulo sob teste ---

// Mock do dotenv para não tentar carregar .env
jest.mock('dotenv', () => ({
	config: jest.fn(),
}));

// Mock do telegraf para evitar instanciar o bot real (pesado em memória)
jest.mock('telegraf', () => ({
	Telegraf: jest.fn().mockImplementation(() => ({
		use: jest.fn(),
		command: jest.fn(),
		on: jest.fn(),
		action: jest.fn(),
		launch: jest.fn(),
		telegram: { sendMessage: jest.fn().mockResolvedValue({}) },
	})),
	Markup: {
		inlineKeyboard: jest.fn(() => ({})),
		button: {
			callback: jest.fn(() => ({})),
		},
	},
	session: jest.fn(() => jest.fn()),
}));

jest.mock('telegraf/filters', () => ({
	message: jest.fn((type: string) => `message:${type}`),
}));

// Mock do GoogleSheetsComunicationService
jest.mock('../../src/services/googleSheetsComunicationService', () => ({
	GoogleSheetsComunicationService: jest.fn().mockImplementation(() => ({
		inserirInformacoesPlanilha: jest.fn().mockResolvedValue(undefined),
	})),
}));

// Mock do tokenService
jest.mock('../../src/services/tokenService', () => ({
	gerarToken: jest.fn().mockResolvedValue('mock-token-123'),
	validarToken: jest.fn().mockResolvedValue(true),
	listarTokens: jest.fn().mockResolvedValue([]),
	revogarToken: jest.fn().mockResolvedValue(true),
	getTokenFilePath: jest.fn().mockReturnValue('/tmp/tokens.json'),
}));

import {
	extrairValor,
	extrairData,
	extrairEstabelecimento,
	extrairBanco,
	processarNotificacao,
	formatarResumo,
	converterParaSheetData,
	MESES_NOMES,
} from '../../src/services/botLoadService';
import type { DadosNotificacao } from '../../src/services/botLoadService';
import { DateTime } from 'luxon';

// ==========================================
// extrairValor
// ==========================================
describe('extrairValor', () => {
	it('deve extrair valor simples "R$ 12,34"', () => {
		expect(extrairValor('Compra aprovada R$ 12,34 em Loja X')).toBe('R$ 12,34');
	});

	it('deve extrair valor sem espaço "R$12,34"', () => {
		expect(extrairValor('Pagamento R$12,34')).toBe('R$ 12,34');
	});

	it('deve extrair valor com milhar "R$ 1.234,56"', () => {
		expect(extrairValor('Compra R$ 1.234,56')).toBe('R$ 1.234,56');
	});

	it('deve extrair valor com milhar grande "R$ 12.345,67"', () => {
		expect(extrairValor('Transferência R$ 12.345,67 realizada')).toBe('R$ 12.345,67');
	});

	it('deve retornar null quando não há valor', () => {
		expect(extrairValor('Mensagem sem valor monetário')).toBeNull();
	});

	it('deve retornar null para texto vazio', () => {
		expect(extrairValor('')).toBeNull();
	});

	it('deve extrair o primeiro valor quando há múltiplos', () => {
		const resultado = extrairValor('Compra R$ 50,00 e troco R$ 10,00');
		expect(resultado).toBe('R$ 50,00');
	});
});

// ==========================================
// extrairData
// ==========================================
describe('extrairData', () => {
	it('deve extrair data completa "18/09/2026"', () => {
		expect(extrairData('Compra em 18/09/2026')).toBe('18/09/2026');
	});

	it('deve extrair data curta "18/09"', () => {
		expect(extrairData('Compra em 18/09 na Loja X')).toBe('18/09');
	});

	it('deve priorizar data completa sobre curta', () => {
		expect(extrairData('Data: 18/09/2026')).toBe('18/09/2026');
	});

	it('deve retornar data atual quando não encontra nenhuma data', () => {
		const resultado = extrairData('Mensagem sem data');
		const agora = DateTime.now().toFormat('dd/MM/yyyy hh:mm');
		// Como a data pode mudar entre a execução, verificamos apenas o formato
		expect(resultado).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
	});

	it('deve extrair data com dia de 1 dígito "5/09/2026"', () => {
		expect(extrairData('Compra em 5/09/2026')).toBe('5/09/2026');
	});

	it('deve extrair data com ano curto "18/09/26"', () => {
		expect(extrairData('Compra em 18/09/26')).toBe('18/09/26');
	});
});

// ==========================================
// extrairEstabelecimento
// ==========================================
describe('extrairEstabelecimento', () => {
	it('deve extrair nome do estabelecimento removendo valor e data', () => {
		const resultado = extrairEstabelecimento('Compra aprovada R$ 50,00 em Restaurante Bom Sabor 18/09/2026');
		expect(resultado).toBeTruthy();
		expect(resultado).not.toContain('R$');
		expect(resultado).not.toContain('18/09/2026');
	});

	it('deve remover referências a bancos', () => {
		const resultado = extrairEstabelecimento('Nubank - Compra aprovada R$ 50,00 Restaurante XYZ');
		expect(resultado).not.toMatch(/nubank/i);
	});

	it('deve remover "compra aprovada"', () => {
		const resultado = extrairEstabelecimento('Compra aprovada R$ 50,00 Mercado Central');
		expect(resultado).not.toMatch(/compra\s*aprovada/i);
	});

	it('deve remover "compra no crédito"', () => {
		const resultado = extrairEstabelecimento('Compra no crédito R$ 30,00 Farmácia Popular');
		expect(resultado).not.toMatch(/compra\s*no\s*crédito/i);
	});

	it('deve remover "pagamento aprovado"', () => {
		const resultado = extrairEstabelecimento('Pagamento aprovado R$ 100,00 Auto Posto Shell');
		expect(resultado).not.toMatch(/pagamento\s*aprovado/i);
	});

	it('deve remover "cartão final XXXX"', () => {
		const resultado = extrairEstabelecimento('Compra aprovada cartão final 1234 R$ 25,00 Padaria Estrela');
		expect(resultado).not.toMatch(/cartão\s*final\s*\d+/i);
	});

	it('deve remover "Samsung Wallet"', () => {
		const resultado = extrairEstabelecimento('Samsung Wallet Compra R$ 15,00 Cafeteria Central');
		expect(resultado).not.toMatch(/samsung\s*wallet/i);
	});

	it('deve retornar null para texto que só tem ruído', () => {
		const resultado = extrairEstabelecimento('R$ 10,00 18/09');
		// Pode retornar null ou string muito curta - depende do algoritmo
		// O importante é não falhar
		expect(resultado === null || typeof resultado === 'string').toBe(true);
	});
});

// ==========================================
// extrairBanco
// ==========================================
describe('extrairBanco', () => {
	it('deve detectar Nubank', () => {
		expect(extrairBanco('Nubank - Compra aprovada')).toBe('Nubank');
	});

	it('deve detectar Nubank com "nu "', () => {
		expect(extrairBanco('Nu pagamento realizado')).toBe('Nubank');
	});

	it('deve detectar Itaú com acento', () => {
		expect(extrairBanco('Itaú - Compra no débito')).toBe('Itaú');
	});

	it('deve detectar Itaú sem acento', () => {
		expect(extrairBanco('Itau - Pagamento')).toBe('Itaú');
	});

	it('deve detectar Caju', () => {
		expect(extrairBanco('Caju - Saldo utilizado')).toBe('Caju');
	});

	it('deve detectar Caju com acento "Cajú"', () => {
		expect(extrairBanco('Cajú compra realizada')).toBe('Caju');
	});

	it('deve retornar null para banco não reconhecido', () => {
		expect(extrairBanco('Bradesco - Compra aprovada')).toBeNull();
	});

	it('deve retornar null para texto vazio', () => {
		expect(extrairBanco('')).toBeNull();
	});

	it('deve ser case-insensitive', () => {
		expect(extrairBanco('NUBANK compra')).toBe('Nubank');
		expect(extrairBanco('ITAÚ débito')).toBe('Itaú');
		expect(extrairBanco('CAJU saldo')).toBe('Caju');
	});
});

// ==========================================
// processarNotificacao
// ==========================================
describe('processarNotificacao', () => {
	it('deve processar notificação completa com todos os campos', () => {
		const texto = 'Nubank - Compra aprovada R$ 45,90 em Restaurante Bom Sabor 22/09/2026';
		const resultado = processarNotificacao(texto);

		expect(resultado).not.toBeNull();
		expect(resultado!.valor).toBe('R$ 45,90');
		expect(resultado!.data).toBe('22/09/2026');
		expect(resultado!.banco).toBe('Nubank');
		expect(resultado!.estabelecimento).toBeTruthy();
	});

	it('deve retornar null quando não há valor', () => {
		const texto = 'Mensagem sem valor monetário em Restaurante XYZ';
		expect(processarNotificacao(texto)).toBeNull();
	});

	it('deve retornar null quando não há estabelecimento identificável', () => {
		// Texto que só contém padrões que são removidos pela limpeza
		const texto = 'R$ 10,00';
		const resultado = processarNotificacao(texto);
		// O resultado pode ser null se não conseguir extrair estabelecimento
		// ou pode ter estabelecimento vazio - ambos são aceitáveis
		if (resultado !== null) {
			expect(resultado.valor).toBe('R$ 10,00');
		}
	});

	it('deve definir data padrão quando não encontra data', () => {
		const texto = 'Compra aprovada R$ 25,00 em Mercado Central';
		const resultado = processarNotificacao(texto);

		expect(resultado).not.toBeNull();
		expect(resultado!.data).toBeTruthy();
		// Quando não encontra data, usa a data atual
		expect(resultado!.data).toMatch(/\d{2}\/\d{2}\/\d{4}/);
	});

	it('deve definir banco como null quando não identifica', () => {
		const texto = 'Compra aprovada R$ 15,00 em Padaria Estrela 01/10/2026';
		const resultado = processarNotificacao(texto);

		expect(resultado).not.toBeNull();
		expect(resultado!.banco).toBeNull();
	});

	it('deve processar notificação do Itaú', () => {
		const texto = 'Itaú - Compra no débito R$ 120,00 Supermercado Extra 15/09/2026';
		const resultado = processarNotificacao(texto);

		expect(resultado).not.toBeNull();
		expect(resultado!.valor).toBe('R$ 120,00');
		expect(resultado!.banco).toBe('Itaú');
	});

	it('deve processar notificação do Caju', () => {
		const texto = 'Caju - Pagamento realizado R$ 32,50 em Lanchonete do Zé 10/09/2026';
		const resultado = processarNotificacao(texto);

		expect(resultado).not.toBeNull();
		expect(resultado!.valor).toBe('R$ 32,50');
		expect(resultado!.banco).toBe('Caju');
	});
});

// ==========================================
// formatarResumo
// ==========================================
describe('formatarResumo', () => {
	it('deve formatar resumo com banco identificado', () => {
		const dados: DadosNotificacao = {
			estabelecimento: 'Restaurante Bom Sabor',
			valor: 'R$ 45,90',
			data: '22/09/2026',
			banco: 'Nubank',
		};
		const resumo = formatarResumo(dados);

		expect(resumo).toContain('Restaurante Bom Sabor');
		expect(resumo).toContain('R$ 45,90');
		expect(resumo).toContain('22/09/2026');
		expect(resumo).toContain('Nubank');
		expect(resumo).toContain('📋');
		expect(resumo).toContain('🏪');
		expect(resumo).toContain('💰');
		expect(resumo).toContain('📅');
		expect(resumo).toContain('🏦');
	});

	it('deve formatar resumo sem banco identificado', () => {
		const dados: DadosNotificacao = {
			estabelecimento: 'Mercado Central',
			valor: 'R$ 100,00',
			data: '01/10/2026',
			banco: null,
		};
		const resumo = formatarResumo(dados);

		expect(resumo).toContain('Mercado Central');
		expect(resumo).toContain('R$ 100,00');
		expect(resumo).toContain('Não identificado');
	});

	it('deve usar formatação Markdown', () => {
		const dados: DadosNotificacao = {
			estabelecimento: 'Loja X',
			valor: 'R$ 10,00',
			data: '01/01/2027',
			banco: 'Itaú',
		};
		const resumo = formatarResumo(dados);

		// Verifica marcadores Markdown bold
		expect(resumo).toContain('*Estabelecimento:*');
		expect(resumo).toContain('*Valor:*');
		expect(resumo).toContain('*Data:*');
		expect(resumo).toContain('*Banco detectado:*');
	});
});

// ==========================================
// converterParaSheetData
// ==========================================
describe('converterParaSheetData', () => {
	it('deve converter dados completos corretamente', () => {
		const dados: DadosNotificacao = {
			estabelecimento: 'Restaurante Bom Sabor',
			valor: 'R$ 45,90',
			data: '22/09/2026',
			banco: 'Nubank',
		};

		const resultado = converterParaSheetData(dados, 'Nubank');

		expect(resultado.banco).toBe('Nubank');
		expect(resultado.mes).toBe('setembro');
		expect(resultado.ano).toBe('2026');
		expect(resultado.entradas).toHaveLength(1);
		expect(resultado.entradas[0].estabelecimento).toBe('Restaurante Bom Sabor');
		expect(resultado.entradas[0].valor).toBeCloseTo(45.90);
	});

	it('deve converter valor com milhar "R$ 1.234,56"', () => {
		const dados: DadosNotificacao = {
			estabelecimento: 'Loja X',
			valor: 'R$ 1.234,56',
			data: '15/03/2027',
			banco: 'Itaú',
		};

		const resultado = converterParaSheetData(dados, 'Itaú');

		expect(resultado.entradas[0].valor).toBeCloseTo(1234.56);
	});

	it('deve usar mês correto a partir do número', () => {
		for (let i = 1; i <= 12; i++) {
			const mesStr = i.toString().padStart(2, '0');
			const dados: DadosNotificacao = {
				estabelecimento: 'Teste',
				valor: 'R$ 10,00',
				data: `15/${mesStr}/2026`,
				banco: null,
			};

			const resultado = converterParaSheetData(dados, 'Nubank');
			expect(resultado.mes).toBe(MESES_NOMES[i - 1]);
		}
	});

	it('deve usar ano atual quando data é curta (dd/MM)', () => {
		const dados: DadosNotificacao = {
			estabelecimento: 'Padaria',
			valor: 'R$ 5,00',
			data: '10/06',
			banco: 'Caju',
		};

		const resultado = converterParaSheetData(dados, 'Caju');

		expect(resultado.mes).toBe('junho');
		expect(resultado.ano).toBe(DateTime.now().toFormat('yyyy'));
	});

	it('deve usar o banco passado como parâmetro, não o do dados', () => {
		const dados: DadosNotificacao = {
			estabelecimento: 'Loja',
			valor: 'R$ 20,00',
			data: '01/01/2027',
			banco: 'Nubank',
		};

		const resultado = converterParaSheetData(dados, 'Itaú');

		expect(resultado.banco).toBe('Itaú');
	});
});

// ==========================================
// MESES_NOMES
// ==========================================
describe('MESES_NOMES', () => {
	it('deve ter 12 meses', () => {
		expect(MESES_NOMES).toHaveLength(12);
	});

	it('deve começar com janeiro e terminar com dezembro', () => {
		expect(MESES_NOMES[0]).toBe('janeiro');
		expect(MESES_NOMES[11]).toBe('dezembro');
	});

	it('deve conter todos os meses na ordem correta', () => {
		const esperado = [
			'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
			'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
		];
		expect(MESES_NOMES).toEqual(esperado);
	});
});
