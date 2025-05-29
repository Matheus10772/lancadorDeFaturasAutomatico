import dotenv from 'dotenv';
import { Markup, Telegraf } from 'telegraf';
import { CSVParser, Banco, CSVRow } from './loadAndParseCSVService';
import { session } from 'telegraf';
import { Context as TelegrafContext } from 'telegraf';
import { sheetData, GoogleSheetsComunicationService } from './googleSheetsComunicationService';
import { User } from 'telegraf/typings/core/types/typegram';


interface MyContext extends TelegrafContext {
	session?: UserSessionData;
}
interface UserSessionData {
	AguardandoCapturaDaProximaResposta: boolean;
	AcaoAnterior: string;
}
interface sequenceOfOptionsButtons {
	nome: string;
	valor: string;
}

dotenv.config();
const bot: Telegraf<MyContext> = new Telegraf(process.env.BOT_TOKEN!)
const csvParser: CSVParser = new CSVParser();
const googleSheetsService: GoogleSheetsComunicationService = new GoogleSheetsComunicationService();

let mes: string;
let ano: string;
let banco: Banco;
let globalDataCSV: CSVRow[] = [];
let currentCSVRow: CSVRow | null | undefined = null;

let dadosJhonatan: { estabelecimento: string, valor: number }[] = [];
let dadosMatheus: { estabelecimento: string, valor: number }[] = [];



const listaDeMeses: sequenceOfOptionsButtons[] = [
	{ nome: 'Janeiro', valor: 'mes_janeiro' },
	{ nome: 'Fevereiro', valor: 'mes_fevereiro' },
	{ nome: 'Março', valor: 'mes_março' },
	{ nome: 'Abril', valor: 'mes_abril' },
	{ nome: 'Maio', valor: 'mes_maio' },
	{ nome: 'Junho', valor: 'mes_junho' },
	{ nome: 'Julho', valor: 'mes_julho' },
	{ nome: 'Agosto', valor: 'mes_agosto' },
	{ nome: 'Setembro', valor: 'mes_setembro' },
	{ nome: 'Outubro', valor: 'mes_outubro' },
	{ nome: 'Novembro', valor: 'mes_novembro' },
	{ nome: 'Dezembro', valor: 'mes_dezembro' }
];

const listaDeBancos: sequenceOfOptionsButtons[] = [
	{ nome: 'Nubank', valor: 'banco_nubank' },
	{ nome: 'Itaú', valor: 'banco_itau' },
	{ nome: 'PicPay', valor: 'banco_picpay' },
	{ nome: 'NossoPay', valor: 'banco_nossopay' },
	{ nome: 'Banco do Brasil', valor: 'banco_bancodobrasil' }
];



function makeSequencButtons(Conjunto: sequenceOfOptionsButtons[], quantiadePorLinha: number): any {

	let ConjuntoFormatado = Conjunto.map(botao => Markup.button.callback(botao.nome!, botao.valor!));

	return ConjuntoFormatado.reduce<ReturnType<typeof Markup.button.callback>[][]>((agregado, _, index) => {
		if (index % quantiadePorLinha === 0) agregado.push(ConjuntoFormatado.slice(index, index + quantiadePorLinha));
		return agregado;
	}, []);

}

async function checkActionToDo(userInput: any, session: UserSessionData): Promise<string> {
	try {
		switch (session.AcaoAnterior) {
			case 'escolhaAno':
				if (/^\d{4}$/.test(userInput)) {
					ano = userInput;
					return "Ano definido com sucesso: " + ano;
				} else {
					return "Formato de ano inválido. Por favor, digite um ano válido (ex: 2025).";
				}
				break;
			case 'enviarPlanilha':
				try {
					// Verifica se é CSV
					if (!userInput.file_name?.endsWith('.csv')) {
						return '❌ Por favor, envie um arquivo com extensão .csv';
					} else {
						const resultMessage: string = await csvParser.writeCSVtoFile(banco, mes, ano, userInput.file_id);

						return resultMessage;
					}
				} catch (error) {
					console.error('Erro ao processar o arquivo:', error);
					return '❌ Erro ao processar o arquivo. Por favor, tente novamente.';
				}
				break;




			default:
				return "Ação não reconhecida.";
				break;
		}
	} catch (error) {
		throw new Error('Erro ao verificar a ação a ser realizada: ' + error);
	}

}

bot.hears(/.*/, async (ctx) => {
	const session = ctx.session as UserSessionData;

	try {
		if (session.AguardandoCapturaDaProximaResposta) {
			const message: string = await checkActionToDo(ctx.message.text, session);
			session.AguardandoCapturaDaProximaResposta = false; // Reseta a flag após o processamento
			ctx.reply(message);
		}
	} catch (error) {
		console.error('Erro ao processar a mensagem:', error);
		session.AguardandoCapturaDaProximaResposta = false; // Reseta a flag após o erro
		ctx.reply('Ocorreu um erro ao processar sua mensagem. Por favor, digite /start e tente novamente.');
	}
});


bot.command('start', async (ctx) => {
	await ctx.reply('Escolha uma opção:', Markup.inlineKeyboard([
		[Markup.button.callback('Escolher Mês', 'escolhaMes')],
		[Markup.button.callback('Escolher Ano', 'escolhaAno')],
		[Markup.button.callback('Escolher Banco', 'escolhaBanco')],
		[Markup.button.callback('Enviar Planilha CSV preenchida', 'enviarPlanilha')],
		[Markup.button.callback('Baixar Modelo de Planilha CSV', 'baixarModelo')],
		[Markup.button.callback('Processar Planilha CSV para o Mês e Ano Definidos', 'processarPlanilha')],
		[Markup.button.callback('Ajuda', 'ajuda')],
	]));
});


bot.action('escolhaMes', async (ctx) => {
	await ctx.answerCbQuery(); // remove o loading
	await ctx.reply('Escolha o Mês que deseja selecionar: ', Markup.inlineKeyboard(makeSequencButtons(listaDeMeses, 2)));
});

bot.action(/^mes_(\w+)$/, async (ctx) => {
	await ctx.answerCbQuery(); //Remove o loading

	const nomeDoMes: string = ctx.match[1]; // "janeiro", "fevereiro", etc.

	mes = nomeDoMes;

	await ctx.reply(`Mês definido com sucesso: ${nomeDoMes}`);

});

bot.action('escolhaBanco', async (ctx) => {
	await ctx.answerCbQuery(); // remove o loading
	await ctx.reply('Escolha o Banco que deseja selecionar: ', Markup.inlineKeyboard(makeSequencButtons(listaDeBancos, 2)) );
});

bot.action(/^banco_(\w+)$/, async (ctx) => {
	await ctx.answerCbQuery(); //Remove o loading

	const nomeBanco: string = ctx.match[1]; // "itau", "nubank", etc.
	banco = Banco[nomeBanco.toLocaleUpperCase() as keyof typeof Banco]; // Converte para o enum Banco usando a string

	await ctx.reply(`Banco definido com sucesso: ${nomeBanco}`);

});



bot.action('escolhaAno', async (ctx) => {
	const session = ctx.session as UserSessionData;
	session.AguardandoCapturaDaProximaResposta = true;
	session.AcaoAnterior = 'escolhaAno';


	await ctx.answerCbQuery();
	await ctx.reply('Digite o ano desejado. Exemplo: 2025',);
});


bot.use((ctx, next) => {
	// Inicializa a sessão como um objeto tipado
	ctx.session = ctx.session ?? { AguardandoCapturaDaProximaResposta: true } as UserSessionData;
	return next();
});


bot.action('enviarPlanilha', async (ctx) => {
	const session = ctx.session as UserSessionData;
	session.AguardandoCapturaDaProximaResposta = true;
	session.AcaoAnterior = 'enviarPlanilha';


	await ctx.answerCbQuery(); // remove o loading
	await ctx.reply('📄 Por favor, envie o arquivo da planilha no formato CSV. O arquivo será armazenado com base no banco selecionado.');

});

bot.on('document', async (ctx) => {
	const file = ctx.message.document;
	const session = ctx.session as UserSessionData;

	try {
		if (session.AguardandoCapturaDaProximaResposta) {
			const resultMessage: string = await checkActionToDo(file, session);
			session.AguardandoCapturaDaProximaResposta = false; // Reseta a flag após o processamento
			ctx.reply(resultMessage);
		}
	} catch (error) {
		console.error('Erro ao processar o arquivo:', error);
		session.AguardandoCapturaDaProximaResposta = false; // Reseta a flag após o erro
		ctx.reply('❌ Erro ao processar o arquivo. Por favor, tente novamente.');
	}

});

bot.action('baixarModelo', async (ctx) => {
	await ctx.answerCbQuery(); // remove o loading

	try {
		const filePath: string = csvParser.getExampleCSV();
		await ctx.replyWithDocument({ source: filePath }, { caption: 'Modelo de planilha CSV' });
	} catch (error) {
		console.error('Erro ao baixar o modelo de planilha:', error);
		await ctx.reply('❌ Erro ao baixar o modelo de planilha. Por favor, tente novamente.');
	}

});


bot.action('processarPlanilha', async (ctx) => {
	await ctx.answerCbQuery(); // remove o loading
	await ctx.reply('Processando a planilha...');
	const session = ctx.session as UserSessionData;


	try {
		if (!banco || !mes || !ano) {
			ctx.reply('❌ Por favor, defina o banco, mês e ano antes de processar a planilha.');
			console.error('Banco, mês ou ano não definidos.');
			return;
		}
		const dataCSV: CSVRow[] = await csvParser.parseCSVtoJSON(banco, mes, ano);
		const dataGoogleSheets: sheetData[] = await googleSheetsService.obterInformacoesPlanilha(mes, ano, [banco]);

		for (let pessoa of dataGoogleSheets) {
			for (let dados of pessoa.dados) {
				if (dados.banco !== banco.toString() || dados.mes !== mes || dados.ano !== ano)
					throw new Error('Banco, mês ou ano dos dados buscados não correspondem aos definidos pelo usuário.');

				// Verifica se algum estabelecimento em dados.entradas existe em algum objeto de dataCSV
				let elementoParaRemover: CSVRow = {} as CSVRow;
				const existeEstabelecimento: boolean = dados.entradas.some(entrada =>
					dataCSV.some(row => {
						if (row.Estabelecimento === entrada.estabelecimento) {
							elementoParaRemover = row;
							return true;
						} else {
							return false;
						}

					})
				);

				if (existeEstabelecimento) {
					removeElementFromArray(dataCSV, elementoParaRemover);
				}
			}

		}

		globalDataCSV = dataCSV; // Armazena os dados CSV globalmente para uso posterior


		if (dataCSV.length > 0) {
			session.AguardandoCapturaDaProximaResposta = true;
			session.AcaoAnterior = 'processarEntrada';
			currentCSVRow = dataCSV.pop()!;


			ctx.reply(`Selecione o que fazer com a entrada\n${currentCSVRow}`, Markup.inlineKeyboard([
				[Markup.button.callback('Jhonatan', 'paraJhonatan')],
				[Markup.button.callback('Matheus', 'paraMatheus')],
				[Markup.button.callback('Dividir entre os 2', 'dividir')],
				[Markup.button.callback('Cancelar', 'cancelarPRocessamento')],
			]));
		}





	} catch (error) {
		console.error('Erro ao processar a planilha:', error);
		await ctx.reply('❌ Erro ao processar a planilha. Por favor, tente novamente.');
	}
});

function atribuirDadoParaPessoa(row: CSVRow, pessoa: string): { message: string, nextRow: CSVRow | null | undefined } {

	let message: string = '';
	let nextRow: CSVRow | null | undefined = null;
	try {
		const valor: number = parseFloat(row.Valor.replace(',', '.'));
		const nomeEstabelecimento: string = row.Estabelecimento;
		dadosJhonatan.push({ estabelecimento: nomeEstabelecimento, valor: valor });
		message = `Entrada adicionada a ${pessoa}: ${nomeEstabelecimento} - R$ ${valor.toFixed(2)}`;
		nextRow = globalDataCSV.pop(); // Pega a próxima entrada ou null se não houver mais


	}

	catch (error) {
		dadosJhonatan = [];
		dadosMatheus = [];
		console.error(`Erro ao processar a entrada para ${pessoa}:`, error);
	}

	return { message, nextRow };
}

function dividirDado(row: CSVRow, pessoa: string[]): { message: string, nextRow: CSVRow | null | undefined } {

	let message: string = '';
	let nextRow: CSVRow | null | undefined = null;
	try {
		const valoresDivididos: number = parseFloat(row.Valor.replace(',', '.')) / pessoa.length;
		const nomeEstabelecimento: string = row.Estabelecimento;

		pessoa.forEach((pessoaNome) => {
			if (pessoaNome.toLocaleLowerCase() === 'jhonatan') {
				dadosJhonatan.push({ estabelecimento: nomeEstabelecimento+'(1/2)', valor: valoresDivididos });
			} else if (pessoaNome.toLocaleLowerCase() === 'matheus') {
				dadosMatheus.push({ estabelecimento: nomeEstabelecimento+'(1/2)', valor: valoresDivididos });
			}
			message = `Entrada adicionada a ${pessoaNome}: ${nomeEstabelecimento} - R$ ${valoresDivididos.toFixed(2)}`;
		});
		nextRow = globalDataCSV.pop(); // Pega a próxima entrada ou null se não houver mais

	}

	catch (error) {
		dadosJhonatan = [];
		dadosMatheus = [];
		console.error(`Erro ao processar a entrada para as pessoas ${pessoa}:`, error);
		throw new Error(`Erro ao processar a entrada. Por favor, tente novamente.`);
	}

	return { message, nextRow };
}

async function formatarEnviarParaGoogleSheets() {
	if (dadosJhonatan.length > 0 || dadosMatheus.length > 0) {
		try {
			const entradasJhonatan = dadosJhonatan.map(dado => ({ estabelecimento: dado.estabelecimento, valor: dado.valor }));
			const entradasMatheus = dadosMatheus.map(dado => ({ estabelecimento: dado.estabelecimento, valor: dado.valor }));

			const dadosFormatados: sheetData[] = [{
				pessoa: 'jhonatan',
				dados: [
					{
						banco: banco.toString(),
						mes: mes,
						ano: ano,
						entradas: entradasJhonatan
					}
				]
			},
			{
				pessoa: 'matheus',
				dados: [
					{
						banco: banco.toString(),
						mes: mes,
						ano: ano,
						entradas: entradasMatheus
					}
				]
			}];

			await googleSheetsService.inserirInformacoesPlanilha(dadosFormatados);

		} catch (error) {
			throw new Error(`Erro ao formatar e enviar os dados para o Google Sheets: ${error}`);
		}


	} else {
		throw new Error('Nenhuma entrada processada para enviar ao Google Sheets.');
	}
}

function sendOptionsForEntry(ctx: any) {
	const sequence: sequenceOfOptionsButtons[] = [
		{ nome: 'Jhonatan', valor: 'paraJhonatan' },
		{ nome: 'Matheus', valor: 'paraMatheus' },
		{ nome: 'Dividir entre os 2', valor: 'dividir' },
		{ nome: 'Cancelar', valor: 'cancelarProcessamento' }
	];
	ctx.reply(`Selecione o que fazer com a próxima entrada\n${currentCSVRow}` , Markup.inlineKeyboard( makeSequencButtons(sequence, 1) ) );
}



bot.action(/^para(.+)/, async (ctx) => { //atribuir entrada para uma pessoa
	await ctx.answerCbQuery();
	const session = ctx.session as UserSessionData;

	// Captura o nome da pessoa a partir do callback (ex: 'Jhonatan' de 'paraJhonatan')
	const pessoa = ctx.match[1]; // 'Jhonatan', 'Matheus', etc.

	if (session.AcaoAnterior && currentCSVRow) {
		const { message, nextRow } = atribuirDadoParaPessoa(currentCSVRow, pessoa);
		currentCSVRow = nextRow;

		await ctx.reply(message);

		if (currentCSVRow) {
			sendOptionsForEntry(ctx); // Envia nova opção para próxima entrada
		} else {
			session.AguardandoCapturaDaProximaResposta = false;
			await formatarEnviarParaGoogleSheets(); // Formata e envia os dados para o Google Sheets

			// Limpa os dados processados
			dadosJhonatan = [];
			dadosMatheus = [];

			await ctx.reply('✅ Processamento concluído. Todas as entradas foram inseridas na planilha.');
		}
	}
});

bot.action('dividir', async (ctx) => { // dividir entrada entre os 2
	await ctx.answerCbQuery();
	const session = ctx.session as UserSessionData;

	if (session.AcaoAnterior && currentCSVRow) {

		try {
			const { message, nextRow } = dividirDado(currentCSVRow, ['Jhonatan', 'Matheus']);
			currentCSVRow = nextRow;

			await ctx.reply(message);

			if (currentCSVRow) {
				sendOptionsForEntry(ctx); // Envia nova opção para próxima entrada
			} else {
				session.AguardandoCapturaDaProximaResposta = false;
				await formatarEnviarParaGoogleSheets(); // Formata e envia os dados para o Google Sheets
				// Limpa os dados processados
				dadosJhonatan = [];
				dadosMatheus = [];

				await ctx.reply('✅ Processamento concluído. Todas as entradas foram inseridas na planilha.');
			}
		} catch (error) {
			console.error('Erro ao dividir a entrada:', error);
			session.AguardandoCapturaDaProximaResposta = false; // Reseta a flag após o erro
			dadosJhonatan = [];
			dadosMatheus = [];
			await ctx.reply('❌ Erro ao processar a divisão da entrada. Por favor, tente novamente.');
		}
	}
});

function removeElementFromArray<T>(array: T[], element: T) {
	const index = array.indexOf(element);
	if (index > -1) {
		array.splice(index, 1);
	}
}




bot.launch();

console.log('Bot started!');

