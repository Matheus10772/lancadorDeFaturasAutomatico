import dotenv from 'dotenv';
import { Markup, Telegraf, session } from 'telegraf';
import { Context as TelegrafContext } from 'telegraf';
import { DateTime } from 'luxon';
import { sheetData, GoogleSheetsComunicationService } from './googleSheetsComunicationService';

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

function extrairBanco(texto: string): string | null {
	const textoLower = texto.toLowerCase();

	if (textoLower.includes('nubank') || textoLower.includes('nu ')) return 'Nubank';
	if (textoLower.includes('itaú') || textoLower.includes('itau')) return 'Itaú';
	if (textoLower.includes('caju') || textoLower.includes('cajú')) return 'Caju';

	return null;
}

function processarNotificacao(texto: string): DadosNotificacao | null {
	const valor: string | null = extrairValor(texto);
	const data: string | null = extrairData(texto);
	const estabelecimento: string | null = extrairEstabelecimento(texto);
	const banco: string | null = extrairBanco(texto);

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

// --- Bot ---

async function startBot() {
	bot.use(session());

	bot.use((ctx, next) => {
		ctx.session = ctx.session ?? { etapa: '', dadosExtraidos: null } as UserSessionData;
		return next();
	});

	bot.command('start', async (ctx) => {
		await ctx.reply('👋 Bot de notificações ativo!\n\nEnvie a notificação do banco (texto) e eu irei processar.');
	});

	// --- Recebe mensagem de texto (notificação do MacroDroid) ---
	bot.on('text', async (ctx) => {
		const session: UserSessionData = ctx.session as UserSessionData;
		const texto: string = ctx.message.text;

		// Se está no meio de uma edição, trata a resposta
		if (session.etapa === 'editando_estabelecimento') {
			session.dadosExtraidos!.estabelecimento = texto;
			session.etapa = '';
			await ctx.reply(`✅ Estabelecimento alterado para: *${texto}*`, { parse_mode: 'Markdown' });
			enviarMenuPrincipal(ctx, session.dadosExtraidos!);
			return;
		}

		if (session.etapa === 'editando_valor') {
			session.dadosExtraidos!.valor = texto;
			session.etapa = '';
			await ctx.reply(`✅ Valor alterado para: *${texto}*`, { parse_mode: 'Markdown' });
			enviarMenuPrincipal(ctx, session.dadosExtraidos!);
			return;
		}

		// Caso contrário, tenta processar como nova notificação
		const dados = processarNotificacao(texto);

		if (!dados) {
			await ctx.reply('⚠️ Não consegui extrair as informações dessa mensagem.\nCertifique-se de que contém o valor (R$) e o nome do estabelecimento.');
			return;
		}

		session.dadosExtraidos = dados;
		session.etapa = '';
		enviarMenuPrincipal(ctx, dados);
	});

	// --- Ação: Adicionar ---
	bot.action('adicionar', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;

		if (!session.dadosExtraidos) {
			await ctx.reply('❌ Nenhum dado para adicionar.');
			return;
		}

		enviarMenuBancos(ctx, session.dadosExtraidos);
	});

	// --- Ação: Ignorar ---
	bot.action('ignorar', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		session.dadosExtraidos = null;
		session.etapa = '';
		await ctx.reply('🗑️ Entrada ignorada.');
	});

	// --- Ação: Editar ---
	bot.action('editar', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;

		if (!session.dadosExtraidos) {
			await ctx.reply('❌ Nenhum dado para editar.');
			return;
		}

		session.etapa = 'editando_estabelecimento';
		await ctx.reply(
			`🏪 Digite o novo nome do estabelecimento:`,
			Markup.inlineKeyboard([
				[Markup.button.callback(`Usar o mesmo: "${session.dadosExtraidos.estabelecimento}"`, 'manter_estabelecimento')],
			])
		);
	});

	// --- Ação: Manter estabelecimento (durante edição) ---
	bot.action('manter_estabelecimento', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;

		if (!session.dadosExtraidos) return;

		// Pula para edição do valor
		session.etapa = 'editando_valor';
		await ctx.reply(
			`💰 Digite o novo valor:`,
			Markup.inlineKeyboard([
				[Markup.button.callback(`Usar o mesmo: "${session.dadosExtraidos.valor}"`, 'manter_valor')],
			])
		);
	});

	// --- Ação: Manter valor (durante edição) ---
	bot.action('manter_valor', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;

		if (!session.dadosExtraidos) return;

		session.etapa = '';
		await ctx.reply('✅ Dados mantidos.');
		enviarMenuPrincipal(ctx, session.dadosExtraidos);
	});

	// --- Ação: Inserir no banco selecionado ---
	bot.action(/^inserir_(.+)$/, async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;
		const banco = ctx.match[1]; // "nubank", "itau", "caju"

		if (!session.dadosExtraidos) {
			await ctx.reply('❌ Nenhum dado para inserir.');
			return;
		}

		const nomeBanco = banco.charAt(0).toUpperCase() + banco.slice(1);

		try {
			await inserirNaPlanilha(session.dadosExtraidos, nomeBanco);

			await ctx.reply(
				`✅ Inserido com sucesso no *${nomeBanco}*!\n\n` +
				`🏪 ${session.dadosExtraidos.estabelecimento}\n` +
				`💰 ${session.dadosExtraidos.valor}\n` +
				`📅 ${session.dadosExtraidos.data}`,
				{ parse_mode: 'Markdown' }
			);
		} catch (error) {
			console.error('Erro ao inserir na planilha:', error);
			await ctx.reply(`❌ Erro ao inserir na planilha: ${error}`);
		}

		// Limpa os dados após inserir
		session.dadosExtraidos = null;
		session.etapa = '';
	});

	bot.launch();
	console.log('Bot started!');
}

export { startBot };