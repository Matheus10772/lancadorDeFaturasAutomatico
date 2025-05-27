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
	await ctx.reply('Escolha o Banco que deseja selecionar: ', Markup.inlineKeyboard(makeSequencButtons(listaDeBancos, 2)));
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

		for(let pessoa of dataGoogleSheets) {
			for(let dados of pessoa.dados) {
				if(dados.banco !== banco.toString() || dados.mes !== mes || dados.ano !== ano)
					throw new Error('Banco, mês ou ano dos dados buscados não correspondem aos definidos pelo usuário.');

				// Verifica se algum estabelecimento em dados.entradas existe em algum objeto de dataCSV
				let elementoParaRemover: CSVRow = {} as CSVRow;
				const existeEstabelecimento: boolean = dados.entradas.some(entrada =>
					dataCSV.some(row => {
						if(row.Estabelecimento === entrada.estabelecimento) {
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


		if(dataCSV.length > 0) {
			session.AguardandoCapturaDaProximaResposta = true;
			session.AcaoAnterior = 'processarEntrada';
			const primeiraEntrada: CSVRow = dataCSV[0];

			ctx.reply(`Selecione o que fazer com a entrada\n${primeiraEntrada}`, Markup.inlineKeyboard([
			[Markup.button.callback('Jhonatan', 'paraJhonatan')],
			[Markup.button.callback('Matheus', 'paraMatheus')],
			[Markup.button.callback('Cancelar', 'cancelarPRocessamento')],
		]));
		}

		for(let data of dataCSV) {
			const { Data ,Estabelecimento, Valor } = data;
			const valor: number = parseFloat(Valor.replace(',', '.') );

			// Aqui eu chamo bot.action para cada entrada
		}

		interface sheetData {
			pessoa: string,
			dados: {
				banco: string,
				mes: string,
				ano: string,
				entradas: {
					estabelecimento: string,
					valor: number
				}[]
			}[]
		}





	} catch (error) {
		console.error('Erro ao processar a planilha:', error);
		await ctx.reply('❌ Erro ao processar a planilha. Por favor, tente novamente.');
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

