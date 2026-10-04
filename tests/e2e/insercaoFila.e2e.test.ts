// =============================================
// E2E: ação "inserir_<banco>" com a fila real
// (Telegraf, planilha e arquivo de falhas mockados)
// =============================================

jest.mock('dotenv', () => ({ config: jest.fn() }));

const mockSendMessage = jest.fn().mockResolvedValue({});
const botMock = {
	use: jest.fn(),
	command: jest.fn(),
	on: jest.fn(),
	action: jest.fn(),
	catch: jest.fn(),
	telegram: { sendMessage: mockSendMessage },
};
jest.mock('telegraf', () => ({
	Telegraf: jest.fn().mockImplementation(() => botMock),
	Markup: {
		inlineKeyboard: jest.fn(() => ({ reply_markup: {} })),
		button: { callback: jest.fn(() => ({})) },
	},
	session: jest.fn(() => jest.fn()),
}));

jest.mock('telegraf/filters', () => ({
	message: jest.fn((type: string) => `message:${type}`),
}));

const mockInserirPlanilha = jest.fn();
jest.mock('../../src/services/googleSheetsComunicationService', () => ({
	GoogleSheetsComunicationService: jest.fn().mockImplementation(() => ({
		inserirInformacoesPlanilha: (...args: any[]) => mockInserirPlanilha(...args),
	})),
}));

jest.mock('../../src/services/tokenService', () => ({
	gerarToken: jest.fn().mockResolvedValue('mock-token'),
}));

const mockRegistrarFalha = jest.fn();
const mockRemoverFalhasDoItem = jest.fn();
const mockListarFalhas = jest.fn();
jest.mock('../../src/services/failedInsertionsService', () => ({
	registrarFalha: (...args: any[]) => mockRegistrarFalha(...args),
	listarFalhas: (...args: any[]) => mockListarFalhas(...args),
	removerFalhasDoItem: (...args: any[]) => mockRemoverFalhasDoItem(...args),
}));

const mockWriteFile = jest.fn().mockResolvedValue(undefined);
jest.mock('fs/promises', () => ({
	readFile: jest.fn(),
	writeFile: (...args: any[]) => mockWriteFile(...args),
	mkdir: jest.fn().mockResolvedValue(undefined),
	rename: jest.fn().mockResolvedValue(undefined),
	readdir: jest.fn().mockResolvedValue([]),
	unlink: jest.fn(),
}));

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

import { startBot, mostrarProximoItemFila, pendingData } from '../../src/services/botLoadService';
import { adicionarItensNaFila, contarItens, proximoItem, limparFila, haAlteracoesNaoSalvas } from '../../src/services/queueService';

const CHAT_ID = 4242;
const ERRO_PLANILHA = 'Unable to parse range: Var_nubank!undefined6:undefined6';

type Handler = (ctx: any) => Promise<void>;
let inserirHandler: Handler;
let failsHandler: Handler;
let savenowHandler: Handler;
let queueLaterHandler: Handler;

function criarCtx() {
	return {
		answerCbQuery: jest.fn().mockResolvedValue(undefined),
		reply: jest.fn().mockResolvedValue({}),
		session: { etapa: '', dadosExtraidos: null },
		chat: { id: CHAT_ID },
		match: ['inserir_nubank', 'nubank'],
	};
}

/** Mensagens enviadas via bot.telegram.sendMessage (texto + opções) */
const mensagensEnviadas = () => mockSendMessage.mock.calls.map(([, texto, opcoes]) => ({ texto: String(texto), opcoes }));

beforeAll(async () => {
	await startBot();
	const acao = (gatilho: string) => botMock.action.mock.calls.find(([g]) => String(g) === gatilho)![1];
	const comando = (nome: string) => botMock.command.mock.calls.find(([c]) => c === nome)![1];
	inserirHandler = acao(String(/^inserir_(.+)$/));
	queueLaterHandler = acao('queue_later');
	failsHandler = comando('fails');
	savenowHandler = comando('savenow');
});

beforeEach(async () => {
	limparFila(CHAT_ID);
	pendingData.clear();
	mockRegistrarFalha.mockResolvedValue({ id: 'falha-1' });
	mockRemoverFalhasDoItem.mockResolvedValue(1);
	mockListarFalhas.mockResolvedValue([]);

	adicionarItensNaFila(CHAT_ID, [
		{ texto: 'Compra aprovada R$ 50,00 em Padaria Pao_Quente', banco: 'Nubank', origem: 'reprocess' },
		{ texto: 'Compra aprovada R$ 20,00 em Mercado Central', banco: 'Nubank', origem: 'reprocess' },
	]);
	await mostrarProximoItemFila(CHAT_ID);
	mockSendMessage.mockClear();
});

describe('E2E: erro ao inserir na planilha', () => {
	it('deve avisar o usuário (sem Markdown) e mostrar o mesmo item da fila novamente', async () => {
		mockInserirPlanilha.mockRejectedValue(new Error(ERRO_PLANILHA));

		await inserirHandler(criarCtx());

		const mensagens = mensagensEnviadas();
		const aviso = mensagens.find(m => m.texto.includes('❌ Erro ao inserir dado na planilha'));
		expect(aviso).toBeDefined();
		expect(aviso!.texto).toContain(ERRO_PLANILHA);
		// O erro contém "_", então não pode ser enviado com parse_mode Markdown
		expect(aviso!.opcoes?.parse_mode).toBeUndefined();

		// Fluxo da fila exibido de novo, com o mesmo item no topo
		const ultima = mensagens[mensagens.length - 1];
		expect(ultima.texto).toContain('Item 1 de 2');
		expect(ultima.texto).toContain('Padaria');
		expect(contarItens(CHAT_ID)).toBe(2);
	});

	it('deve registrar a falha uma única vez e vinculá-la ao item da fila', async () => {
		mockInserirPlanilha.mockRejectedValue(new Error(ERRO_PLANILHA));

		await inserirHandler(criarCtx());
		await inserirHandler(criarCtx()); // nova tentativa também falha

		expect(mockRegistrarFalha).toHaveBeenCalledTimes(1);
		expect(proximoItem(CHAT_ID)?.falhaId).toBe('falha-1');
	});

	it('deve passar o ID do item da fila como origemId da falha', async () => {
		mockInserirPlanilha.mockRejectedValue(new Error(ERRO_PLANILHA));
		const idItem = proximoItem(CHAT_ID)!.id;

		await inserirHandler(criarCtx());

		expect(mockRegistrarFalha).toHaveBeenCalledWith(CHAT_ID, expect.any(Object), 'Nubank', ERRO_PLANILHA, idItem);
	});

	it('após falhar, uma nova tentativa com sucesso remove a falha e avança a fila', async () => {
		mockInserirPlanilha.mockRejectedValueOnce(new Error(ERRO_PLANILHA));
		await inserirHandler(criarCtx());

		mockInserirPlanilha.mockResolvedValueOnce(undefined);
		const ctx = criarCtx();
		await inserirHandler(ctx);

		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Inserido com sucesso'), expect.anything());
		expect(mockRemoverFalhasDoItem).toHaveBeenCalledWith(CHAT_ID, { falhaId: 'falha-1', origemId: expect.stringMatching(/^q-/) });
		expect(contarItens(CHAT_ID)).toBe(1);
		expect(proximoItem(CHAT_ID)?.texto).toContain('Mercado Central');
	});

	it('deve avisar o usuário mesmo se registrar a falha também falhar', async () => {
		mockInserirPlanilha.mockRejectedValue(new Error(ERRO_PLANILHA));
		mockRegistrarFalha.mockRejectedValue(new Error('EACCES'));

		await inserirHandler(criarCtx());

		expect(mensagensEnviadas().some(m => m.texto.includes('❌ Erro ao inserir dado na planilha'))).toBe(true);
		expect(contarItens(CHAT_ID)).toBe(2);
	});
});

describe('E2E: inserção com sucesso', () => {
	it('deve escapar o Markdown na confirmação e avançar para o próximo item', async () => {
		mockInserirPlanilha.mockResolvedValue(undefined);
		const ctx = criarCtx();

		await inserirHandler(ctx);

		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Pao\\_Quente'), { parse_mode: 'Markdown' });
		expect(mockRegistrarFalha).not.toHaveBeenCalled();
		expect(contarItens(CHAT_ID)).toBe(1);
		const ultima = mensagensEnviadas().pop()!;
		expect(ultima.texto).toContain('Mercado Central');
	});
});

describe('E2E: /fails sem duplicatas', () => {
	it('não duplica a falha cujo item de origem ainda está na fila (mesmo sem falhaId vinculado)', async () => {
		const itemOrigem = proximoItem(CHAT_ID)!;
		mockListarFalhas.mockResolvedValue([{
			id: 'falha-9', estabelecimento: 'Padaria Pao_Quente', valor: 'R$ 50,00', data: '03/10/2026',
			banco: 'Nubank', bancoSelecionado: 'Nubank', falhouEm: '2026-10-03', erro: 'x', origemId: itemOrigem.id,
		}]);

		await failsHandler(criarCtx());

		expect(contarItens(CHAT_ID)).toBe(2);
	});

	it('mantém falhas idênticas de itens diferentes (compras repetidas legítimas)', async () => {
		const falha = (id: string, origemId: string) => ({
			id, estabelecimento: 'Café', valor: 'R$ 5,00', data: '03/10/2026',
			banco: 'Nubank', bancoSelecionado: 'Nubank', falhouEm: '2026-10-03', erro: 'x', origemId,
		});
		mockListarFalhas.mockResolvedValue([falha('f-a', 'q-a'), falha('f-b', 'q-b')]);

		await failsHandler(criarCtx());

		expect(contarItens(CHAT_ID)).toBe(4);
	});
});

describe('E2E: persistência pelo Telegram', () => {
	it('/savenow grava a fila em disco e informa a quantidade', async () => {
		mockWriteFile.mockClear();
		const ctx = { ...criarCtx(), chat: { id: CHAT_ID } };

		await savenowHandler(ctx);

		expect(mockWriteFile).toHaveBeenCalled();
		expect(haAlteracoesNaoSalvas()).toBe(false);
		expect(ctx.reply).toHaveBeenCalledWith('💾 Fila salva em disco: 2 item(ns).');
	});

	it('/savenow avisa o usuário se a gravação falhar', async () => {
		mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC'));
		const erroLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
		const ctx = criarCtx();

		await savenowHandler(ctx);

		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Erro ao salvar a fila'));
		erroLog.mockRestore();
	});

	it('"Continuar depois" grava o snapshot e mantém os itens na fila', async () => {
		mockWriteFile.mockClear();
		const ctx = criarCtx();

		await queueLaterHandler(ctx);

		expect(mockWriteFile).toHaveBeenCalled();
		expect(contarItens(CHAT_ID)).toBe(2);
		expect(pendingData.has(CHAT_ID)).toBe(false);
		expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('*2* item(ns) salvo(s)'), { parse_mode: 'Markdown' });
	});
});
