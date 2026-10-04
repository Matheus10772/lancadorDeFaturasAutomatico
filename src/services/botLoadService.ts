import dotenv from 'dotenv';
import { Markup, Telegraf, session } from 'telegraf';
import { Context as TelegrafContext } from 'telegraf';
import { message } from 'telegraf/filters';
import { DateTime } from 'luxon';
import { sheetData, GoogleSheetsComunicationService } from './googleSheetsComunicationService';
import { gerarToken } from './tokenService';
import { registrarFalha, listarFalhas, removerFalhasDoItem } from './failedInsertionsService';
import {
	adicionarItensNaFila,
	proximoItem,
	removerPrimeiroItem,
	atualizarPrimeiroItem,
	contarItens,
	salvarFilasEmDisco,
} from './queueService';
import type { NovoQueueItem, QueueItem } from './queueService';

// --- Interfaces ---

interface MyContext extends TelegrafContext {
	session?: UserSessionData;
}

interface UserSessionData {
	etapa: string;
	dadosExtraidos: DadosNotificacao | null;
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

// --- Mapa de dados do item em exibição ---
// Armazena os dados processados do item da fila que está aguardando
// confirmação do usuário no Telegram (fonte de verdade para as actions).
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

	return DateTime.now().toFormat('dd/MM/yyyy HH:mm'); // Retorna a data atual se não encontrar nenhuma
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

/**
 * Escapa os caracteres especiais do Markdown (legado) do Telegram.
 * Sem isso, textos como "IFD*RESTAURANTE" ou "Var_nubank" fazem o Telegram
 * rejeitar a mensagem inteira ("can't parse entities").
 */
function escaparMarkdown(texto: string): string {
	return texto.replace(/([_*`\[])/g, '\\$1');
}

function formatarResumo(dados: DadosNotificacao): string {
	const bancoInfo = dados.banco ? `🏦 *Banco detectado:* ${escaparMarkdown(dados.banco)}` : '🏦 *Banco:* Não identificado';
	return `📋 *Dados detectados:*\n\n🏪 *Estabelecimento:* ${escaparMarkdown(dados.estabelecimento)}\n💰 *Valor:* ${escaparMarkdown(dados.valor)}\n📅 *Data:* ${escaparMarkdown(dados.data)}\n${bancoInfo}`;
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

/**
 * Extrai mês (nome) e ano (4 dígitos) de uma data nos formatos "dd/MM", "dd/MM/yy",
 * "dd/MM/yyyy" ou "dd/MM/yyyy HH:mm". Sem data reconhecível, usa o mês/ano atual.
 */
function extrairMesAno(data: string): { mes: string; ano: string } {
	const agora = DateTime.now();
	const match = data.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);

	const mesNumero = match ? parseInt(match[2], 10) : agora.month;
	let anoNumero = match?.[3] ? parseInt(match[3], 10) : agora.year;
	if (anoNumero < 100) anoNumero += 2000; // "26" → 2026

	if (mesNumero < 1 || mesNumero > 12) {
		throw new Error(`Mês inválido na data "${data}"`);
	}

	return { mes: MESES_NOMES[mesNumero - 1], ano: String(anoNumero) };
}

function converterParaSheetData(dados: DadosNotificacao, banco: string): sheetData {
	const { mes, ano } = extrairMesAno(dados.data);

	// Converte o valor de "R$ 12,34" para número
	const valorNumerico = Number(
		dados.valor.replace('R$', '').replace(/\s/g, '').replace('.', '').replace(',', '.')
	);

	return {
		banco,
		mes,
		ano,
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

// --- Fila unificada ---

/**
 * Obtém os dados do item em exibição. Prioriza o mapa de pendentes (item da fila)
 * e usa a session apenas como fallback.
 */
function obterDadosExtraidos(chatId: number, session: UserSessionData): DadosNotificacao | null {
	return pendingData.get(chatId) ?? session.dadosExtraidos ?? null;
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

/**
 * Mostra o primeiro item da fila (sem removê-lo) com os botões de ação.
 * Itens não processáveis são pulados automaticamente.
 */
async function mostrarProximoItemFila(chatId: number): Promise<void> {
	while (true) {
		const item = proximoItem(chatId);

		if (!item) {
			pendingData.delete(chatId);
			await bot.telegram.sendMessage(chatId, '✅ Todos os itens da fila foram processados!');
			return;
		}

		// Itens vindos de falhas já têm os dados processados
		const dados: DadosNotificacao | null = item.dadosProcessados
			? { ...item.dadosProcessados }
			: processarNotificacao(item.texto, item.banco);

		if (!dados) {
			await bot.telegram.sendMessage(chatId, '⏭️ Item não processável (sem valor/estabelecimento). Pulando...');
			removerPrimeiroItem(chatId);
			continue;
		}

		pendingData.set(chatId, dados);

		const total = contarItens(chatId);
		await bot.telegram.sendMessage(
			chatId,
			`📋 *Item 1 de ${total}*\n\n${formatarResumo(dados)}`,
			{
				parse_mode: 'Markdown',
				...Markup.inlineKeyboard([
					[Markup.button.callback('✅ Adicionar', 'adicionar')],
					[Markup.button.callback('✏️ Editar', 'editar')],
					[Markup.button.callback('🗑️ Descartar', 'queue_discard')],
					[Markup.button.callback('⏸️ Continuar depois', 'queue_later')],
				]),
			}
		);
		return;
	}
}

/**
 * Adiciona itens na fila. Se a fila estava vazia, mostra o primeiro item;
 * caso contrário, apenas avisa que o item foi enfileirado.
 */
async function enfileirarEMostrar(chatId: number, itens: NovoQueueItem[]): Promise<void> {
	const filaEstavaVazia = contarItens(chatId) === 0;
	const adicionados = adicionarItensNaFila(chatId, itens);

	if (adicionados === 0) {
		await bot.telegram.sendMessage(chatId, '⚠️ Item já está na fila.');
		return;
	}

	if (filaEstavaVazia) {
		await mostrarProximoItemFila(chatId);
		return;
	}

	await bot.telegram.sendMessage(
		chatId,
		`📡 ${adicionados} item(ns) adicionado(s) à fila. Total pendente: ${contarItens(chatId)}.\nUse /fila para ver a fila.`
	);
}

/**
 * Remove o item atual da fila, limpa os dados em exibição e mostra o próximo.
 */
async function avancarFila(chatId: number, session: UserSessionData): Promise<void> {
	removerPrimeiroItem(chatId);
	armazenarDadosExtraidos(chatId, session, null);
	session.etapa = '';
	await mostrarProximoItemFila(chatId);
}

/**
 * Remove do arquivo de falhas tudo o que estiver ligado ao item (pelo falhaId ou pelo ID de origem).
 */
async function removerFalhasLigadas(chatId: number, item: QueueItem): Promise<void> {
	await removerFalhasDoItem(chatId, { falhaId: item.falhaId, origemId: item.id });
}

/**
 * Trata uma falha de inserção na planilha: registra a falha (uma única vez por item),
 * avisa o usuário e mostra o mesmo item novamente, para que ele possa tentar de novo,
 * editar, descartar ou continuar depois.
 */
async function tratarErroInsercao(chatId: number, dados: DadosNotificacao, nomeBanco: string, erroStr: string): Promise<void> {
	const item = proximoItem(chatId);

	// Itens vindos de /fila (ou que já falharam antes) já têm uma falha registrada
	let falhaId = item?.falhaId;
	if (!falhaId) {
		try {
			// origemId = ID do item da fila: o mesmo item nunca gera duas falhas
			falhaId = (await registrarFalha(chatId, dados, nomeBanco, erroStr, item?.id)).id;
		} catch (erroRegistro) {
			console.error('Erro ao registrar falha de inserção:', erroRegistro);
		}
	}

	const proximoPasso = item
		? 'O item continua na fila: você pode tentar adicionar de novo, editar, descartar ou continuar depois.'
		: 'A inserção foi salva nas falhas. Use /fila para tentar novamente.';

	// Sem parse_mode: a mensagem de erro pode conter "_" ou "*" (ex.: "Var_nubank")
	await bot.telegram.sendMessage(chatId, `❌ Erro ao inserir dado na planilha.\n\nErro: ${erroStr}\n\n${proximoPasso}`);

	if (item) {
		// Mantém o item no topo da fila com os dados atuais (inclusive edições) e vinculado à falha
		atualizarPrimeiroItem(chatId, { dadosProcessados: { ...dados }, falhaId });
		await mostrarProximoItemFila(chatId);
	}
}

/**
 * Processa uma notificação recebida via HTTP (MacroDroid).
 * Valida o texto e o adiciona na fila unificada do chat.
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

	await enfileirarEMostrar(chatId, [{ texto, banco: banco ?? '', origem: 'macrodroid' }]);

	return dados;
}

/**
 * Adiciona uma lista de itens vindos via /reprocess-pending na fila unificada.
 */
async function iniciarFilaReprocess(chatId: number, itens: { texto: string; banco: string }[]): Promise<void> {
	const novos: NovoQueueItem[] = itens.map(i => ({ texto: i.texto, banco: i.banco, origem: 'reprocess' }));
	const adicionados = adicionarItensNaFila(chatId, novos);

	await bot.telegram.sendMessage(
		chatId,
		`📡 *${adicionados} item(ns) adicionado(s) à fila.*`,
		{ parse_mode: 'Markdown' }
	);

	if (adicionados > 0) {
		await mostrarProximoItemFila(chatId);
	}
}

// --- Bot ---

async function startBot() {
	bot.use(session());

	bot.use((ctx, next) => {
		ctx.session = ctx.session ?? { etapa: '', dadosExtraidos: null } as UserSessionData;
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
		await ctx.reply(
			'👋 Bot de notificações ativo!\n\nEnvie a notificação do banco (texto) e eu irei processar.\n\n' +
			'/fila — mostra a fila de itens pendentes (inclui inserções que falharam)\n' +
			'/savenow — salva a fila em disco imediatamente\n' +
			'/token — gera um token de API para o MacroDroid'
		);
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

	// IMPORTANTE: os comandos precisam ser registrados ANTES de bot.on(message('text')),
	// senão o handler de texto captura "/fila" e "/savenow" como se fossem notificações.

	// --- Comando: Mostrar a fila (itens pendentes + inserções que falharam) ---
	bot.command('fila', async (ctx) => {
		const chatId = ctx.chat.id;

		// A fila em memória já inclui os itens restaurados do disco na inicialização.
		// Aqui só acrescentamos as inserções que falharam (sem duplicar as que já estão na fila).
		const falhas = await listarFalhas(chatId);
		adicionarItensNaFila(chatId, falhas.map((f): NovoQueueItem => ({
			// Reaproveita o ID do item que gerou a falha: se ele ainda estiver na fila, não duplica
			...(f.origemId ? { id: f.origemId } : {}),
			// Texto reconstruído (usado apenas para exibição/depuração; a deduplicação usa IDs)
			texto: `${f.estabelecimento} R$ ${f.valor}`,
			banco: f.bancoSelecionado,
			origem: 'falha',
			dadosProcessados: {
				estabelecimento: f.estabelecimento,
				valor: f.valor,
				data: f.data,
				banco: f.banco,
			},
			falhaId: f.id,
		})));

		const total = contarItens(chatId);
		if (total === 0) {
			await ctx.reply('✅ Nenhum item pendente!');
			return;
		}

		await ctx.reply(`📋 *${total}* item(ns) na fila.`, { parse_mode: 'Markdown' });
		await mostrarProximoItemFila(chatId);
	});

	// --- Comando: Salvar a fila em disco agora ---
	bot.command('savenow', async (ctx) => {
		try {
			await salvarFilasEmDisco();
			const total = contarItens(ctx.chat.id);
			await ctx.reply(`💾 Fila salva em disco: ${total} item(ns).`);
		} catch (error) {
			console.error('Erro ao salvar a fila via /savenow:', error);
			await ctx.reply('❌ Erro ao salvar a fila em disco. Tente novamente.');
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
			await ctx.reply(`✅ Estabelecimento alterado para: *${escaparMarkdown(texto)}*`, { parse_mode: 'Markdown' });
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
			await ctx.reply(`✅ Valor alterado para: *${escaparMarkdown(texto)}*`, { parse_mode: 'Markdown' });
			if (dados) enviarMenuPrincipal(ctx, dados);
			return;
		}

		// Caso contrário, tenta processar como nova notificação
		const dados = processarNotificacao(texto);

		if (!dados) {
			await ctx.reply('⚠️ Não consegui extrair as informações dessa mensagem.\nCertifique-se de que contém o valor (R$) e o nome do estabelecimento.');
			return;
		}

		session.etapa = '';
		await enfileirarEMostrar(chatId, [{ texto, banco: '', origem: 'manual' }]);
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

	// --- Ação: Ignorar / Descartar (descarta o item atual da fila) ---
	const descartarItemAtual = async (ctx: any, mensagemFila: string, mensagemSemFila: string) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId: number = ctx.chat?.id ?? 0;

		const item = proximoItem(chatId);
		if (!item) {
			armazenarDadosExtraidos(chatId, session, null);
			session.etapa = '';
			await ctx.reply(mensagemSemFila);
			return;
		}

		// Remove do arquivo de falhas o que estiver ligado a este item
		await removerFalhasLigadas(chatId, item);

		await ctx.reply(mensagemFila);
		await avancarFila(chatId, session);
	};

	bot.action('ignorar', (ctx) => descartarItemAtual(ctx, '🗑️ Item ignorado.', '🗑️ Entrada ignorada.'));
	bot.action('queue_discard', (ctx) => descartarItemAtual(ctx, '🗑️ Item descartado.', '❌ Nenhum item na fila.'));

	// --- Ação: Continuar depois (salva a fila em disco) ---
	bot.action('queue_later', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const chatId = ctx.chat?.id ?? 0;

		// Os itens continuam na fila em memória; só paramos de exibi-los e gravamos o snapshot
		await salvarFilasEmDisco();
		armazenarDadosExtraidos(chatId, session, null);
		session.etapa = '';

		await ctx.reply(
			`⏸️ Fila pausada. *${contarItens(chatId)}* item(ns) salvo(s).\nUse /fila para continuar.`,
			{ parse_mode: 'Markdown' }
		);
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
		const item = proximoItem(chatId); // peek: só é removido depois de inserir com sucesso

		try {
			await inserirNaPlanilha(dados, nomeBanco);
		} catch (error) {
			console.error('Erro ao inserir na planilha:', error);
			const erroStr = error instanceof Error ? error.message : String(error);

			armazenarDadosExtraidos(chatId, session, null);
			session.etapa = '';
			await tratarErroInsercao(chatId, dados, nomeBanco, erroStr);
			return;
		}

		await ctx.reply(
			`✅ Inserido com sucesso no *${escaparMarkdown(nomeBanco)}*!\n\n` +
			`🏪 ${escaparMarkdown(dados.estabelecimento)}\n` +
			`💰 ${escaparMarkdown(dados.valor)}\n` +
			`📅 ${escaparMarkdown(dados.data)}`,
			{ parse_mode: 'Markdown' }
		);

		// Remove do arquivo de falhas o que estiver ligado a este item
		if (item) {
			await removerFalhasLigadas(chatId, item);
		}

		if (item) {
			await avancarFila(chatId, session);
		} else {
			armazenarDadosExtraidos(chatId, session, null);
			session.etapa = '';
		}
	});

	// --- Tratamento global de erros: nenhum erro de handler deve passar em silêncio ---
	bot.catch(async (error, ctx) => {
		console.error(`Erro não tratado ao processar update "${ctx.updateType}":`, error);
		try {
			await ctx.reply('❌ Ocorreu um erro inesperado. Tente novamente ou use /fila para retomar a fila.');
		} catch (erroResposta) {
			console.error('Não foi possível avisar o usuário sobre o erro:', erroResposta);
		}
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
	iniciarFilaReprocess,
	inserirNaPlanilha,
	mostrarProximoItemFila,
	extrairValor,
	extrairData,
	extrairEstabelecimento,
	extrairBanco,
	processarNotificacao,
	formatarResumo,
	converterParaSheetData,
	obterDadosExtraidos,
	armazenarDadosExtraidos,
	pendingData,
	MESES_NOMES,
};
export type { DadosNotificacao, UserSessionData };
