import dotenv from 'dotenv';
import { Markup, Telegraf, session } from 'telegraf';
import { Context as TelegrafContext } from 'telegraf';
import { message } from 'telegraf/filters';
import { DateTime } from 'luxon';
import { sheetData, GoogleSheetsComunicationService } from './googleSheetsComunicationService';
import { gerarToken } from './tokenService';
import { registrarFalha, listarFalhas, removerFalha, contarFalhas } from './failedInsertionsService';
import type { FailedInsertion } from './failedInsertionsService';

// --- Interfaces ---

interface MyContext extends TelegrafContext {
	session?: UserSessionData;
}

interface UserSessionData {
	etapa: string;
	dadosExtraidos: DadosNotificacao | null;
	// --- Fluxo de revisão de falhas (/fails) ---
	falhasEmRevisao: FailedInsertion[] | null;
	indiceFalhaAtual: number;
	falhaAtualId: string | null;
	// --- Fluxo de reprocessamento em fila (/reprocess-pending) ---
	reprocessItems: PendingReprocessItem[] | null;
	reprocessIndice: number;
}

interface PendingReprocessItem {
	texto: string;
	banco: string;
}

interface DadosNotificacao {
	estabelecimento: string;
	valor: string;
	data: string;
	banco: string | null;
}

// --- Configuração ---

dotenv.config();
const bot: Telegraf<MyContext> = new Telegraf(process.env.BOT_TOKEN!);
const googleSheetsService: GoogleSheetsComunicationService = new GoogleSheetsComunicationService();

// --- Mapa de dados pendentes (vindos via HTTP) ---
// Armazena dados processados de notificações recebidas via HTTP
// que aguardam confirmação do usuário no Telegram.
const pendingData: Map<number, DadosNotificacao> = new Map();

// --- Funções de extração ---

function extrairValor(texto: string): string | null {
	// Procura padrões como "R$ 12,34" ou "R$12.345,67" ou "R$ 1.234,56"
	const regex = /R\$\s?([\d.,]+)/i;
	const match = texto.match(regex);
	return match ? `R$ ${match[1]}` : null;
}

function extrairData(texto: string): string | null {
	// Procura padrões como "18/09/2026", "18/09", "18 set", "18 de setembro"
	const regexCompleta = /(\d{1,2}\/\d{1,2}\/\d{2,4})/;
	const regexCurta = /(\d{1,2}\/\d{1,2})/;

	const matchCompleta = texto.match(regexCompleta);
	if (matchCompleta) return matchCompleta[1];

	const matchCurta = texto.match(regexCurta);
	if (matchCurta) return matchCurta[1];

	return DateTime.now().toFormat('dd/MM/yyyy hh:mm'); // Retorna a data atual se não encontrar nenhuma
}

function extrairEstabelecimento(texto: string): string | null {
	// Remove o valor monetário e a data para tentar isolar o nome do estabelecimento
	let limpo = texto
		.replace(/R\$\s?[\d.,]+/gi, '')
		.replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, '')
		.replace(/compra\s*(aprovada|no\s*crédito|no\s*débito)/gi, '')
		.replace(/pagamento\s*(aprovado|realizado)/gi, '')
		.replace(/cartão\s*final\s*\d+/gi, '')
		.replace(/nubank|itaú|itau|caju/gi, '')
		.replace(/samsung\s*wallet/gi, '')
		.replace(/\b(em|no|na|de|do|da|com|para|por)\b/gi, '')
		.replace(/\s{2,}/g, ' ')
		.trim();

	// Pega a parte mais significativa (geralmente o nome do estabelecimento)
	// Remove linhas vazias e pega a primeira parte com conteúdo
	const linhas = limpo.split('\n').map(l => l.trim()).filter(l => l.length > 2);
	return linhas.length > 0 ? linhas[0] : null;
}

function extrairBanco(texto?: string): string | null {
	if (!texto) return null;

	const textoLower = texto.toLowerCase();

	if (textoLower.includes('nubank') || textoLower.includes('nu ')) return 'Nubank';
	if (textoLower.includes('itaú') || textoLower.includes('itau')) return 'Itaú';
	if (textoLower.includes('caju') || textoLower.includes('cajú')) return 'Caju';

	return null;

}

function processarNotificacao(texto: string, bancoEnviado?: string): DadosNotificacao | null {
	const valor: string | null = extrairValor(texto);
	const data: string | null = extrairData(texto);
	const estabelecimento: string | null = extrairEstabelecimento(texto);
	const banco: string | null = extrairBanco(bancoEnviado) ?? extrairBanco(texto);

	if (!valor || !estabelecimento) return null;

	//ToDo: Adicionar verificação: Obtém a última inserção na planilha, se o estabelecimento for igual e o valor for igual, e uma notificação tiver uma diferença de tempo de uma para outra de menos de 10 minutos, então a inserção não é feita

	return {
		estabelecimento,
		valor,
		data: data ?? 'Não identificada',
		banco,
	};
}

// --- Funções de mensagem ---

function formatarResumo(dados: DadosNotificacao): string {
	const bancoInfo = dados.banco ? `🏦 *Banco detectado:* ${dados.banco}` : '🏦 *Banco:* Não identificado';
	return `📋 *Dados detectados:*\n\n🏪 *Estabelecimento:* ${dados.estabelecimento}\n💰 *Valor:* ${dados.valor}\n📅 *Data:* ${dados.data}\n${bancoInfo}`;
}

function enviarMenuPrincipal(ctx: any, dados: DadosNotificacao) {
	ctx.reply(
		formatarResumo(dados),
		{
			parse_mode: 'Markdown',
			...Markup.inlineKeyboard([
				[Markup.button.callback('✅ Adicionar', 'adicionar')],
				[Markup.button.callback('✏️ Editar', 'editar')],
				[Markup.button.callback('❌ Ignorar', 'ignorar')],
			])
		}
	);
}

function enviarMenuBancos(ctx: any, dados: DadosNotificacao) {
	const botoes = [];

	if (dados.banco) {
		botoes.push([Markup.button.callback(`✅ Manter o detectado: ${dados.banco}`, `inserir_${dados.banco.toLowerCase()}`)]);
	}

	botoes.push(
		[Markup.button.callback('💜 Nubank', 'inserir_nubank')],
		[Markup.button.callback('🧡 Itaú', 'inserir_itau')],
		[Markup.button.callback('💚 Caju', 'inserir_caju')],
	);

	ctx.reply('🏦 Selecione o banco para inserir:', Markup.inlineKeyboard(botoes));
}

// --- Mapeamento de número do mês para nome ---

const MESES_NOMES: string[] = [
	'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
	'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

function converterParaSheetData(dados: DadosNotificacao, banco: string): sheetData {
	// Extrai mês e ano da data (formato "dd/MM/yyyy" ou "dd/MM")
	const partesData = dados.data.split('/');
	const mesNumero = parseInt(partesData[1], 10); // 1-12
	const ano = partesData[2] ?? DateTime.now().toFormat('yyyy');

	const mes = MESES_NOMES[mesNumero - 1];

	// Converte o valor de "R$ 12,34" para número
	const valorNumerico = Number(
		dados.valor.replace('R$', '').replace(/\s/g, '').replace('.', '').replace(',', '.')
	);

	return {
		banco,
		mes,
		ano: ano.toString(),
		entradas: [{ estabelecimento: dados.estabelecimento, valor: valorNumerico }],
	};
}

async function inserirNaPlanilha(dados: DadosNotificacao, banco: string): Promise<void> {
	const sheetDataConvertido: sheetData = converterParaSheetData(dados, banco);

	console.log('===== INSERINDO NA PLANILHA =====');
	console.log(`Banco: ${banco}`);
	console.log(`Mês: ${sheetDataConvertido.mes} | Ano: ${sheetDataConvertido.ano}`);
	console.log(`Estabelecimento: ${dados.estabelecimento}`);
	console.log(`Valor: ${sheetDataConvertido.entradas[0].valor}`);
	console.log('=================================');

	await googleSheetsService.inserirInformacoesPlanilha(sheetDataConvertido);
}

// --- Processamento de notificação externa (via HTTP) ---

/**
 * Processa uma notificação recebida via HTTP (MacroDroid).
 * Extrai os dados, armazena no mapa de pendentes, e envia o menu de confirmação
 * ao chat do Telegram para o usuário aprovar.
 *
 * @returns Os dados extraídos ou null se não foi possível processar
 */
async function processarNotificacaoExterna(chatId: number, texto: string, banco?: string): Promise<DadosNotificacao | null> {
	const dados = processarNotificacao(texto, banco);

	if (!dados) {
		await bot.telegram.sendMessage(
			chatId,
			'⚠️ Notificação recebida via HTTP, mas não consegui extrair as informações.\n' +
			'Certifique-se de que contém o valor (R$) e o nome do estabelecimento.'
		);
		return null;
	}

	// Armazena no mapa de dados pendentes
	pendingData.set(chatId, dados);

	// Envia menu de confirmação ao Telegram
	const resumo = formatarResumo(dados);
	await bot.telegram.sendMessage(
		chatId,
		`📡 *Notificação recebida via MacroDroid:*\n\n${resumo}`,
		{
			parse_mode: 'Markdown',
			...Markup.inlineKeyboard([
				[Markup.button.callback('✅ Adicionar', 'adicionar')],
				[Markup.button.callback('✏️ Editar', 'editar')],
				[Markup.button.callback('❌ Ignorar', 'ignorar')],
			]),
		}
	);

	return dados;
}

/**
 * Obtém os dados extraídos para um chat, verificando tanto a session quanto o mapa de pendentes.
 * Prioriza dados da session (interação direta com o bot).
 */
function obterDadosExtraidos(chatId: number, session: UserSessionData): DadosNotificacao | null {
	return session.dadosExtraidos ?? pendingData.get(chatId) ?? null;
}

/**
 * Armazena dados extraídos tanto na session quanto no mapa de pendentes.
 */
function armazenarDadosExtraidos(chatId: number, session: UserSessionData, dados: DadosNotificacao | null): void {
	session.dadosExtraidos = dados;
	if (dados) {
		pendingData.set(chatId, dados);
	} else {
		pendingData.delete(chatId);
	}
}

// --- Funções auxiliares para revisão de falhas ---

function formatarResumoFalha(falha: FailedInsertion, indice: number, total: number): string {
	const bancoInfo = falha.banco ? `🏦 *Banco detectado:* ${falha.banco}` : '🏦 *Banco:* Não identificado';
	const dataFalha = new Date(falha.falhouEm).toLocaleString('pt-BR');
	return (
		`⚠️ *Falha ${indice + 1} de ${total}*\n\n` +
		`🏪 *Estabelecimento:* ${falha.estabelecimento}\n` +
		`💰 *Valor:* ${falha.valor}\n` +
		`📅 *Data:* ${falha.data}\n` +
		`${bancoInfo}\n` +
		`🏦 *Banco selecionado:* ${falha.bancoSelecionado}\n\n` +
		`🕐 *Falhou em:* ${dataFalha}\n` +
		`❗ *Erro:* ${falha.erro}`
	);
}

async function mostrarFalhaAtual(ctx: any, session: UserSessionData): Promise<void> {
	if (!session.falhasEmRevisao || session.indiceFalhaAtual >= session.falhasEmRevisao.length) {
		session.falhasEmRevisao = null;
		session.indiceFalhaAtual = 0;
		session.falhaAtualId = null;
		session.etapa = '';
		await ctx.reply('✅ Todas as falhas foram revisadas!');
		return;
	}

	const falha = session.falhasEmRevisao[session.indiceFalhaAtual];
	const total = session.falhasEmRevisao.length;
	const resumo = formatarResumoFalha(falha, session.indiceFalhaAtual, total);

	await ctx.reply(
		resumo,
		{
			parse_mode: 'Markdown',
			...Markup.inlineKeyboard([
				[Markup.button.callback('🔄 Reinserir', 'fails_retry')],
				[Markup.button.callback('⏭️ Pular', 'fails_skip')],
				[Markup.button.callback('🔚 Cancelar revisão', 'fails_cancel')],
			]),
		}
	);
}

async function mostrarProximaFalha(ctx: any, session: UserSessionData, chatId: number): Promise<void> {
	// Recarrega a lista de falhas do arquivo (pode ter mudado após remoção)
	const falhasAtualizadas = await listarFalhas(chatId);
	session.falhasEmRevisao = falhasAtualizadas;

	// Encontra o próximo índice válido
	if (session.indiceFalhaAtual >= falhasAtualizadas.length) {
		session.indiceFalhaAtual = falhasAtualizadas.length; // vai finalizar
	}

	await mostrarFalhaAtual(ctx, session);
}

// --- Funções auxiliares para reprocessamento em fila ---

/**
 * Inicia o processamento de uma fila de itens vindos via /reprocess-pending.
 * Armazena a fila no mapa de pendentes e envia o primeiro item ao Telegram.
 */
async function iniciarFilaReprocess(chatId: number, itens: PendingReprocessItem[]): Promise<void> {
	// Armazena a fila em memória (indexada por chatId)
	reprocessQueues.set(chatId, { items: itens, index: 0 });

	await bot.telegram.sendMessage(
		chatId,
		`📡 *Recebidos ${itens.length} item(ns) para reprocessamento.*\nVou mostrar um a um para confirmação.`,
		{ parse_mode: 'Markdown' }
	);

	await mostrarProximoReprocessItem(chatId);
}

/**
 * Mostra o próximo item da fila de reprocessamento no Telegram.
 */
async function mostrarProximoReprocessItem(chatId: number): Promise<void> {
	const queue = reprocessQueues.get(chatId);
	if (!queue || queue.index >= queue.items.length) {
		reprocessQueues.delete(chatId);
		await bot.telegram.sendMessage(
			chatId,
			'✅ Todos os itens do reprocessamento foram revisados!'
		);
		return;
	}

	const item = queue.items[queue.index];
	const total = queue.items.length;
	const atual = queue.index + 1;
	const restantes = total - atual;

	// Processa o texto para extrair dados e mostrar resumo
	const dados = processarNotificacao(item.texto, item.banco);

	if (!dados) {
		// Item não processável — pula automaticamente
		await bot.telegram.sendMessage(
			chatId,
			`⏭️ *Item ${atual} de ${total}* — Não foi possível extrair informações.\nTexto: _${item.texto}_`,
			{ parse_mode: 'Markdown' }
		);
		queue.index++;
		await mostrarProximoReprocessItem(chatId);
		return;
	}

	// Armazena os dados no pendingData para o fluxo normal funcionar
	pendingData.set(chatId, dados);

	const resumo = formatarResumo(dados);
	await bot.telegram.sendMessage(
		chatId,
		`📋 *Item ${atual} de ${total}* (${restantes} restante(s))\n\n${resumo}`,
		{
			parse_mode: 'Markdown',
			...Markup.inlineKeyboard([
				[Markup.button.callback('✅ Adicionar', 'adicionar')],
				[Markup.button.callback('✏️ Editar', 'editar')],
				[Markup.button.callback('🗑️ Descartar', 'reprocess_discard')],
				[Markup.button.callback('⏸️ Continuar depois', 'reprocess_later')],
			]),
		}
	);
}

/**
 * Salva os itens restantes da fila de reprocessamento como inserções falhadas.
 */
async function salvarRestantesComoFalhas(chatId: number): Promise<number> {
	const queue = reprocessQueues.get(chatId);
	if (!queue) return 0;

	let salvos = 0;
	for (let i = queue.index; i < queue.items.length; i++) {
		const item = queue.items[i];
		if (!item.texto || item.texto.trim() === '') continue;

		const dados = processarNotificacao(item.texto, item.banco);
		if (!dados) continue;

		await registrarFalha(
			chatId,
			dados,
			item.banco || 'Não definido',
			'Adiado pelo usuário via reprocessamento'
		);
		salvos++;
	}

	reprocessQueues.delete(chatId);
	return salvos;
}

// Mapa de filas de reprocessamento em memória (por chatId)
const reprocessQueues: Map<number, { items: PendingReprocessItem[]; index: number }> = new Map();

// --- Bot ---

async function startBot() {
	bot.use(session());

	bot.use((ctx, next) => {
		ctx.session = ctx.session ?? {
			etapa: '',
			dadosExtraidos: null,
			falhasEmRevisao: null,
			indiceFalhaAtual: 0,
			falhaAtualId: null,
			reprocessItems: null,
			reprocessIndice: 0,
		} as UserSessionData;
		return next();
	});

	// Middleware de autorização: só permite o chat autorizado
	const chatIdAutorizado = Number(process.env.TELEGRAM_CHAT_ID);
	bot.use((ctx, next) => {
		if (ctx.chat?.id !== chatIdAutorizado) {
			console.warn(`Acesso negado para chat ID: ${ctx.chat?.id}`);
			return; // Ignora silenciosamente
		}
		return next();
	});

	bot.command('start', async (ctx) => {
		await ctx.reply('👋 Bot de notificações ativo!\n\nEnvie a notificação do banco (texto) e eu irei processar.\n\nUse /token para gerar um token de API para o MacroDroid.');
	});

	// --- Comando: Gerar token de API ---
	bot.command('token', async (ctx) => {
		try {
			const novoToken = await gerarToken('Token gerado via Telegram');
			await ctx.reply(
				`🔑 *Token gerado com sucesso!*\n\n` +
				`\`${novoToken}\`\n\n` +
				`⚠️ Guarde este token em local seguro. Ele será usado para autenticação na API do MacroDroid.`,
				{ parse_mode: 'Markdown' }
			);
		} catch (error) {
			console.error('Erro ao gerar token:', error);
			await ctx.reply('❌ Erro ao gerar token. Tente novamente.');
		}
	});

	// --- Recebe mensagem de texto (notificação direta no Telegram) ---
	bot.on(message('text'), async (ctx) => {
		const session: UserSessionData = ctx.session as UserSessionData;
		const texto: string = ctx.message.text;
		const chatId: number = ctx.chat.id;

		// Se está no meio de uma edição, trata a resposta
		if (session.etapa === 'editando_estabelecimento') {
			const dados = obterDadosExtraidos(chatId, session);
			if (dados) {
				dados.estabelecimento = texto;
				armazenarDadosExtraidos(chatId, session, dados);
			}
			session.etapa = '';
			await ctx.reply(`✅ Estabelecimento alterado para: *${texto}*`, { parse_mode: 'Markdown' });
			if (dados) enviarMenuPrincipal(ctx, dados);
			return;
		}

		if (session.etapa === 'editando_valor') {
			const dados = obterDadosExtraidos(chatId, session);
			if (dados) {
				dados.valor = texto;
				armazenarDadosExtraidos(chatId, session, dados);
			}
			session.etapa = '';
			await ctx.reply(`✅ Valor alterado para: *${texto}*`, { parse_mode: 'Markdown' });
			if (dados) enviarMenuPrincipal(ctx, dados);
			return;
		}

		// Caso contrário, tenta processar como nova notificação
		const dados = processarNotificacao(texto);

		if (!dados) {
			await ctx.reply('⚠️ Não consegui extrair as informações dessa mensagem.\nCertifique-se de que contém o valor (R$) e o nome do estabelecimento.');
			return;
		}

		armazenarDadosExtraidos(chatId, session, dados);
		session.etapa = '';
		enviarMenuPrincipal(ctx, dados);
	});

	// --- Ação: Adicionar ---
	bot.action('adicionar', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		const dados = obterDadosExtraidos(chatId, session);
		if (!dados) {
			await ctx.reply('❌ Nenhum dado para adicionar.');
			return;
		}

		enviarMenuBancos(ctx, dados);
	});

	// --- Ação: Ignorar ---
	bot.action('ignorar', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		const estaRevisandoFalhas = session.etapa === 'revisando_falhas';
		const falhaAtualId = session.falhaAtualId;

		armazenarDadosExtraidos(chatId, session, null);

		if (estaRevisandoFalhas && falhaAtualId) {
			// Remove a falha ignorada da lista
			await removerFalha(chatId, falhaAtualId);
			session.falhaAtualId = null;
			await ctx.reply('🗑️ Falha removida da lista.');
			await mostrarProximaFalha(ctx, session, chatId);
		} else {
			session.etapa = '';
			await ctx.reply('🗑️ Entrada ignorada.');
		}
	});

	// --- Ação: Editar ---
	bot.action('editar', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		const dados = obterDadosExtraidos(chatId, session);
		if (!dados) {
			await ctx.reply('❌ Nenhum dado para editar.');
			return;
		}

		session.etapa = 'editando_estabelecimento';
		await ctx.reply(
			`🏪 Digite o novo nome do estabelecimento:`,
			Markup.inlineKeyboard([
				[Markup.button.callback(`Usar o mesmo: "${dados.estabelecimento}"`, 'manter_estabelecimento')],
			])
		);
	});

	// --- Ação: Manter estabelecimento (durante edição) ---
	bot.action('manter_estabelecimento', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		const dados = obterDadosExtraidos(chatId, session);
		if (!dados) return;

		// Pula para edição do valor
		session.etapa = 'editando_valor';
		await ctx.reply(
			`💰 Digite o novo valor:`,
			Markup.inlineKeyboard([
				[Markup.button.callback(`Usar o mesmo: "${dados.valor}"`, 'manter_valor')],
			])
		);
	});

	// --- Ação: Manter valor (durante edição) ---
	bot.action('manter_valor', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		const dados = obterDadosExtraidos(chatId, session);
		if (!dados) return;

		session.etapa = '';
		await ctx.reply('✅ Dados mantidos.');
		enviarMenuPrincipal(ctx, dados);
	});

	// --- Ação: Inserir no banco selecionado ---
	bot.action(/^inserir_(.+)$/, async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;
		const banco = ctx.match[1]; // "nubank", "itau", "caju"

		const dados = obterDadosExtraidos(chatId, session);
		if (!dados) {
			await ctx.reply('❌ Nenhum dado para inserir.');
			return;
		}

		const nomeBanco = banco.charAt(0).toUpperCase() + banco.slice(1);
		const estaRevisandoFalhas = session.etapa === 'revisando_falhas';
		const falhaAtualId = session.falhaAtualId;
		const estaReprocessando = reprocessQueues.has(chatId);

		try {
			await inserirNaPlanilha(dados, nomeBanco);

			await ctx.reply(
				`✅ Inserido com sucesso no *${nomeBanco}*!\n\n` +
				`🏪 ${dados.estabelecimento}\n` +
				`💰 ${dados.valor}\n` +
				`📅 ${dados.data}`,
				{ parse_mode: 'Markdown' }
			);

			// Se estava revisando falhas, remove a falha que foi inserida com sucesso
			if (estaRevisandoFalhas && falhaAtualId) {
				await removerFalha(chatId, falhaAtualId);
			}
		} catch (error) {
			console.error('Erro ao inserir na planilha:', error);
			const erroStr = error instanceof Error ? error.message : String(error);

			// Se já estava retentando uma falha, recolocamos na lista
			if (estaRevisandoFalhas && falhaAtualId) {
				// A falha original já está na lista — só não removemos ela
				await ctx.reply(
					`❌ Erro ao inserir na planilha novamente. O item permanece na lista de falhas.\n` +
					`Erro: ${erroStr}`
				);
			} else {
				// Primeira falha: registra no arquivo
				await registrarFalha(chatId, dados, nomeBanco, erroStr);
				const totalFalhas = await contarFalhas(chatId);
				await ctx.reply(
					`❌ Erro ao inserir na planilha: ${erroStr}\n\n` +
					`📋 A inserção foi salva na fila de falhas. ` +
					`Você tem *${totalFalhas}* inserção(ões) pendente(s).\n` +
					`Use /fails para revisar.`,
					{ parse_mode: 'Markdown' }
				);
			}
		}

		// Limpa os dados atuais
		armazenarDadosExtraidos(chatId, session, null);

		// Decide para onde voltar após a inserção
		if (estaRevisandoFalhas) {
			session.falhaAtualId = null;
			await mostrarProximaFalha(ctx, session, chatId);
		} else if (estaReprocessando) {
			const queue = reprocessQueues.get(chatId);
			if (queue) {
				queue.index++;
				await mostrarProximoReprocessItem(chatId);
			}
			session.etapa = '';
		} else {
			session.etapa = '';
		}
	});

	// --- Comando: Listar inserções falhadas ---
	bot.command('fails', async (ctx) => {
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat.id;

		const falhas = await listarFalhas(chatId);

		if (falhas.length === 0) {
			await ctx.reply('✅ Nenhuma inserção falhada pendente!');
			return;
		}

		await ctx.reply(
			`📋 Você tem *${falhas.length}* inserção(ões) falhada(s) pendente(s).`,
			{ parse_mode: 'Markdown' }
		);

		// Armazena a lista na sessão e começa a mostrar uma por uma
		session.falhasEmRevisao = falhas;
		session.indiceFalhaAtual = 0;
		session.etapa = 'revisando_falhas';

		await mostrarFalhaAtual(ctx, session);
	});

	// --- Ação: Retentar inserção falhada ---
	bot.action('fails_retry', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		if (!session.falhasEmRevisao || session.indiceFalhaAtual >= session.falhasEmRevisao.length) {
			await ctx.reply('❌ Nenhuma falha para retentar.');
			return;
		}

		const falha = session.falhasEmRevisao[session.indiceFalhaAtual];

		// Converte a falha em DadosNotificacao e coloca no menu de confirmação
		const dados: DadosNotificacao = {
			estabelecimento: falha.estabelecimento,
			valor: falha.valor,
			data: falha.data,
			banco: falha.banco,
		};

		session.falhaAtualId = falha.id;
		armazenarDadosExtraidos(chatId, session, dados);
		// etapa permanece 'revisando_falhas' para que o handler de inserir_ saiba voltar para a lista

		enviarMenuPrincipal(ctx, dados);
	});

	// --- Ação: Pular falha atual ---
	bot.action('fails_skip', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		if (!session.falhasEmRevisao) {
			await ctx.reply('❌ Nenhuma lista de falhas ativa.');
			return;
		}

		session.indiceFalhaAtual++;
		await mostrarProximaFalha(ctx, session, chatId);
	});

	// --- Ação: Cancelar revisão de falhas ---
	bot.action('fails_cancel', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;

		session.falhasEmRevisao = null;
		session.indiceFalhaAtual = 0;
		session.falhaAtualId = null;
		session.etapa = '';
		await ctx.reply('🔚 Revisão de falhas encerrada.');
	});
	// --- Ação: Descartar item do reprocessamento ---
	bot.action('reprocess_discard', async (ctx) => {
		await ctx.answerCbQuery();
		const chatId = ctx.chat?.id ?? 0;
		const session = ctx.session as UserSessionData;

		armazenarDadosExtraidos(chatId, session, null);

		const queue = reprocessQueues.get(chatId);
		if (!queue) {
			await ctx.reply('❌ Nenhuma fila de reprocessamento ativa.');
			return;
		}

		await ctx.reply('🗑️ Item descartado.');
		queue.index++;
		await mostrarProximoReprocessItem(chatId);
	});

	// --- Ação: Continuar depois (salva restantes como falhas) ---
	bot.action('reprocess_later', async (ctx) => {
		await ctx.answerCbQuery();
		const chatId = ctx.chat?.id ?? 0;
		const session = ctx.session as UserSessionData;

		armazenarDadosExtraidos(chatId, session, null);

		const salvos = await salvarRestantesComoFalhas(chatId);

		if (salvos > 0) {
			await ctx.reply(
				`⏸️ Reprocessamento pausado.\n\n` +
				`📋 *${salvos}* item(ns) salvo(s) na fila de falhas.\n` +
				`Use /fails para revisar quando quiser.`,
				{ parse_mode: 'Markdown' }
			);
		} else {
			await ctx.reply('⏸️ Reprocessamento pausado. Nenhum item restante para salvar.');
		}

		session.etapa = '';
	});

	// Webhook será configurado pelo servidor Express
	console.log('Bot middleware configurado (modo webhook).');
}

/** Configura o webhook do Telegram no servidor indicado pela WEBHOOK_URL */
async function setupWebhook(): Promise<void> {
	const webhookUrl = process.env.WEBHOOK_URL;
	const webhookSecret = process.env.WEBHOOK_SECRET;
	if (!webhookUrl) throw new Error('WEBHOOK_URL não está definida no .env');
	if (!webhookSecret) throw new Error('WEBHOOK_SECRET não está definida no .env');

	// Limpa webhook anterior antes de registrar o novo
	await bot.telegram.deleteWebhook();
	console.log('Webhook anterior removido.');

	// Camada 2: path secreto (não adivinhável)
	const webhookPath = `/webhook-telegram-${webhookSecret}`;
	const fullUrl = `${webhookUrl}${webhookPath}`;

	// Camada 1: secret_token — Telegram envia como header X-Telegram-Bot-Api-Secret-Token
	await bot.telegram.setWebhook(fullUrl, { secret_token: webhookSecret });
	console.log(`Webhook do Telegram configurado com secret_token e path secreto.`);
}

/** Retorna o path e o callback handler do webhook para usar com Express */
function getWebhookCallback() {
	const webhookSecret = process.env.WEBHOOK_SECRET;
	if (!webhookSecret) throw new Error('WEBHOOK_SECRET não está definida no .env');

	const webhookPath = `/webhook-telegram-${webhookSecret}`;

	return {
		path: webhookPath,
		handler: bot.webhookCallback(webhookPath, { secretToken: webhookSecret }),
	};
}

export {
	startBot,
	setupWebhook,
	getWebhookCallback,
	bot,
	processarNotificacaoExterna,
	inserirNaPlanilha,
	extrairValor,
	extrairData,
	extrairEstabelecimento,
	extrairBanco,
	processarNotificacao,
	formatarResumo,
	formatarResumoFalha,
	converterParaSheetData,
	obterDadosExtraidos,
	armazenarDadosExtraidos,
	mostrarFalhaAtual,
	mostrarProximaFalha,
	iniciarFilaReprocess,
	mostrarProximoReprocessItem,
	salvarRestantesComoFalhas,
	reprocessQueues,
	pendingData,
	MESES_NOMES,
};
export type { DadosNotificacao, UserSessionData, PendingReprocessItem };