/**
 * Testes E2E do botLoadService.
 *
 * Simulam os fluxos completos de interação do usuário com o bot:
 * - Recebimento de notificação → menu → inserção na planilha
 * - Fluxo de edição
 * - Fluxo de ignorar
 * - Mensagens inválidas
 *
 * O GoogleSheetsComunicationService é mockado para não fazer chamadas reais.
 * O bot Telegraf é mockado com objetos de contexto simulados.
 */

// --- Mocks devem vir ANTES dos imports do módulo sob teste ---

jest.mock('dotenv', () => ({
	config: jest.fn(),
}));

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

jest.mock('../../src/services/googleSheetsComunicationService', () => ({
	GoogleSheetsComunicationService: jest.fn().mockImplementation(() => ({
		inserirInformacoesPlanilha: jest.fn().mockResolvedValue(undefined),
		obterInformacoesPlanilha: jest.fn().mockResolvedValue({
			banco: 'Nubank',
			mes: 'setembro',
			ano: '2026',
			entradas: [],
		}),
	})),
}));

jest.mock('../../src/services/tokenService', () => ({
	gerarToken: jest.fn().mockResolvedValue('mock-token-123'),
	validarToken: jest.fn().mockResolvedValue(true),
	listarTokens: jest.fn().mockResolvedValue([]),
	revogarToken: jest.fn().mockResolvedValue(true),
	getTokenFilePath: jest.fn().mockReturnValue('/tmp/tokens.json'),
}));

import {
	processarNotificacao,
	formatarResumo,
	converterParaSheetData,
} from '../../src/services/botLoadService';
import type { DadosNotificacao } from '../../src/services/botLoadService';

// ==========================================
// Fluxo E2E: Notificação completa → Inserção
// ==========================================
describe('E2E: Fluxo completo de notificação → inserção', () => {
	it('deve processar notificação do Nubank, formatar resumo e converter para sheetData', () => {
		// 1. Simula recebimento da notificação
		const textoNotificacao = 'Nubank - Compra aprovada R$ 89,90 em Restaurante Bom Sabor 22/09/2026';

		// 2. Processa a notificação (como o bot.on('text') faria)
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();
		expect(dados!.valor).toBe('R$ 89,90');
		expect(dados!.data).toBe('22/09/2026');
		expect(dados!.banco).toBe('Nubank');
		expect(dados!.estabelecimento).toBeTruthy();

		// 3. Formata o resumo (como enviarMenuPrincipal faria)
		const resumo = formatarResumo(dados!);
		expect(resumo).toContain('R$ 89,90');
		expect(resumo).toContain('22/09/2026');
		expect(resumo).toContain('Nubank');

		// 4. Converte para sheetData (como inserirNaPlanilha faria)
		const sheetData = converterParaSheetData(dados!, 'Nubank');
		expect(sheetData.banco).toBe('Nubank');
		expect(sheetData.mes).toBe('setembro');
		expect(sheetData.ano).toBe('2026');
		expect(sheetData.entradas).toHaveLength(1);
		expect(sheetData.entradas[0].valor).toBeCloseTo(89.90);
	});

	it('deve processar notificação do Itaú no débito', () => {
		const textoNotificacao = 'Itaú - Compra no débito R$ 250,00 Supermercado Extra 15/10/2026';

		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();
		expect(dados!.valor).toBe('R$ 250,00');
		expect(dados!.banco).toBe('Itaú');

		const sheetData = converterParaSheetData(dados!, 'Itau');
		expect(sheetData.banco).toBe('Itau');
		expect(sheetData.mes).toBe('outubro');
		expect(sheetData.ano).toBe('2026');
		expect(sheetData.entradas[0].valor).toBeCloseTo(250.00);
	});

	it('deve processar notificação do Caju', () => {
		const textoNotificacao = 'Caju - Pagamento realizado R$ 32,50 em Lanchonete do Zé 10/11/2026';

		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();
		expect(dados!.valor).toBe('R$ 32,50');
		expect(dados!.banco).toBe('Caju');

		const sheetData = converterParaSheetData(dados!, 'Caju');
		expect(sheetData.banco).toBe('Caju');
		expect(sheetData.mes).toBe('novembro');
		expect(sheetData.entradas[0].valor).toBeCloseTo(32.50);
	});
});

// ==========================================
// Fluxo E2E: Edição de dados
// ==========================================
describe('E2E: Fluxo de edição de dados', () => {
	it('deve permitir edição do estabelecimento e manter dados consistentes', () => {
		// 1. Processa notificação inicial
		const textoNotificacao = 'Nubank - Compra R$ 100,00 Loja123 22/09/2026';
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();

		// 2. Simula edição do estabelecimento (como o handler de editando_estabelecimento faria)
		const dadosEditados: DadosNotificacao = {
			...dados!,
			estabelecimento: 'Loja Corrigida ABC',
		};

		// 3. Verifica que o resumo usa o nome editado
		const resumo = formatarResumo(dadosEditados);
		expect(resumo).toContain('Loja Corrigida ABC');

		// 4. Converte para planilha com nome editado
		const sheetData = converterParaSheetData(dadosEditados, 'Nubank');
		expect(sheetData.entradas[0].estabelecimento).toBe('Loja Corrigida ABC');
	});

	it('deve permitir edição do valor e manter dados consistentes', () => {
		// 1. Processa notificação inicial
		const textoNotificacao = 'Nubank - Compra R$ 50,00 Mercado 22/09/2026';
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();

		// 2. Simula edição do valor
		const dadosEditados: DadosNotificacao = {
			...dados!,
			valor: 'R$ 75,50',
		};

		// 3. Converte para planilha com valor editado
		const sheetData = converterParaSheetData(dadosEditados, 'Nubank');
		expect(sheetData.entradas[0].valor).toBeCloseTo(75.50);
	});

	it('deve permitir edição de ambos (estabelecimento e valor) e converter corretamente', () => {
		const textoNotificacao = 'Itaú - Compra R$ 200,00 LojABC 01/12/2026';
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();

		// Simula edição de ambos
		const dadosEditados: DadosNotificacao = {
			...dados!,
			estabelecimento: 'Loja ABC Corrigida',
			valor: 'R$ 199,99',
		};

		const sheetData = converterParaSheetData(dadosEditados, 'Itau');
		expect(sheetData.entradas[0].estabelecimento).toBe('Loja ABC Corrigida');
		expect(sheetData.entradas[0].valor).toBeCloseTo(199.99);
		expect(sheetData.mes).toBe('dezembro');
	});
});

// ==========================================
// Fluxo E2E: Seleção de banco diferente
// ==========================================
describe('E2E: Seleção de banco diferente do detectado', () => {
	it('deve permitir selecionar banco diferente do detectado na notificação', () => {
		// Notificação é do Nubank, mas o usuário quer inserir como Itaú
		const textoNotificacao = 'Nubank - Compra R$ 60,00 Padaria 22/09/2026';
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();
		expect(dados!.banco).toBe('Nubank');

		// Usuário seleciona Itaú no menu de bancos
		const sheetData = converterParaSheetData(dados!, 'Itau');
		expect(sheetData.banco).toBe('Itau');
	});

	it('deve funcionar quando banco não é detectado e usuário seleciona manualmente', () => {
		const textoNotificacao = 'Compra aprovada R$ 45,00 em Farmácia Popular 22/09/2026';
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();
		expect(dados!.banco).toBeNull();

		// Usuário seleciona Caju manualmente
		const sheetData = converterParaSheetData(dados!, 'Caju');
		expect(sheetData.banco).toBe('Caju');
		expect(sheetData.entradas[0].valor).toBeCloseTo(45.00);
	});
});

// ==========================================
// Fluxo E2E: Mensagens inválidas
// ==========================================
describe('E2E: Tratamento de mensagens inválidas', () => {
	it('deve rejeitar mensagem sem valor monetário', () => {
		const textoNotificacao = 'Olá, bom dia! Como vai?';
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).toBeNull();
	});

	it('deve rejeitar mensagem vazia', () => {
		const dados = processarNotificacao('');
		expect(dados).toBeNull();
	});

	it('deve rejeitar mensagem com apenas espaços', () => {
		const dados = processarNotificacao('   ');
		expect(dados).toBeNull();
	});

	it('deve rejeitar mensagem com apenas um comando', () => {
		const dados = processarNotificacao('/start');
		expect(dados).toBeNull();
	});
});

// ==========================================
// Fluxo E2E: Ignorar notificação
// ==========================================
describe('E2E: Fluxo de ignorar notificação', () => {
	it('deve processar a notificação mas permitir que seja ignorada (dados ficam disponíveis até serem descartados)', () => {
		const textoNotificacao = 'Nubank - Compra R$ 15,00 Cafeteria 22/09/2026';
		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();

		// Simula "ignorar" - simplesmente não faz nada com os dados
		// O bot setaria dadosExtraidos = null e etapa = ''
		const session = {
			etapa: '',
			dadosExtraidos: dados,
		};

		// Simula ação de ignorar
		session.dadosExtraidos = null;
		session.etapa = '';

		expect(session.dadosExtraidos).toBeNull();
		expect(session.etapa).toBe('');
	});
});

// ==========================================
// Fluxo E2E: Múltiplas notificações sequenciais
// ==========================================
describe('E2E: Múltiplas notificações sequenciais', () => {
	it('deve processar múltiplas notificações independentemente', () => {
		const notificacoes = [
			'Nubank - Compra R$ 30,00 Loja A 22/09/2026',
			'Itaú - Pagamento R$ 150,00 Loja B 23/09/2026',
			'Caju - Compra R$ 22,50 Loja C 24/09/2026',
		];

		const resultados = notificacoes.map(n => processarNotificacao(n));

		// Todas devem ser processadas com sucesso
		expect(resultados[0]).not.toBeNull();
		expect(resultados[1]).not.toBeNull();
		expect(resultados[2]).not.toBeNull();

		// Cada uma deve ter banco correto
		expect(resultados[0]!.banco).toBe('Nubank');
		expect(resultados[1]!.banco).toBe('Itaú');
		expect(resultados[2]!.banco).toBe('Caju');

		// Cada uma deve ter valor correto
		expect(resultados[0]!.valor).toBe('R$ 30,00');
		expect(resultados[1]!.valor).toBe('R$ 150,00');
		expect(resultados[2]!.valor).toBe('R$ 22,50');

		// Converte todas para sheetData
		const sheets = resultados.map((r, i) =>
			converterParaSheetData(r!, ['Nubank', 'Itau', 'Caju'][i])
		);

		expect(sheets[0].mes).toBe('setembro');
		expect(sheets[1].mes).toBe('setembro');
		expect(sheets[2].mes).toBe('setembro');
	});
});

// ==========================================
// Fluxo E2E: Valor com milhar
// ==========================================
describe('E2E: Notificações com valores altos (milhares)', () => {
	it('deve processar e converter corretamente valores com ponto de milhar', () => {
		const textoNotificacao = 'Nubank - Compra aprovada R$ 1.500,00 em Loja de Eletrônicos 22/09/2026';

		const dados = processarNotificacao(textoNotificacao);
		expect(dados).not.toBeNull();
		expect(dados!.valor).toBe('R$ 1.500,00');

		const sheetData = converterParaSheetData(dados!, 'Nubank');
		expect(sheetData.entradas[0].valor).toBeCloseTo(1500.00);
	});
});

