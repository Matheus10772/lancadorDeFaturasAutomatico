import dotenv from 'dotenv';
import { Markup, Telegraf, session } from 'telegraf';
import { CSVParser, Banco, CSVRow } from './loadAndParseCSVService';
import { Context as TelegrafContext } from 'telegraf';
import { sheetData, GoogleSheetsComunicationService } from './googleSheetsComunicationService';


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

const listaDeSeparadoresCSV: sequenceOfOptionsButtons[] = [
	{ nome: 'Vírgula (,)', valor: 'separador_virgula' },
	{ nome: 'Ponto e vírgula (;)', valor: 'separador_pontoVirgula' }
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

function atribuirDadoParaPessoa(row: CSVRow, pessoa: string): { message: string, nextRow: CSVRow | null | undefined } {

	let message: string = '';
	let nextRow: CSVRow | null | undefined = null;
	try {


		const valor: number = row.Valor;
		const nomeEstabelecimento: string = row.Estabelecimento;

		if(pessoa.toLocaleLowerCase() === 'jhonatan') 
			dadosJhonatan.push({ estabelecimento: nomeEstabelecimento, valor: valor });
		else if(pessoa.toLocaleLowerCase() === 'matheus') 
			dadosMatheus.push({ estabelecimento: nomeEstabelecimento, valor: valor });
		else 
			throw new Error('Pessoa inválida. Deve ser "Jhonatan" ou "Matheus".');
		
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
		const valoresDivididos: number = row.Valor / pessoa.length;
		const nomeEstabelecimento: string = row.Estabelecimento;

		for(let pessoaNome of pessoa) {
			if (pessoaNome.toLocaleLowerCase() === 'jhonatan') {
				dadosJhonatan.push({ estabelecimento: nomeEstabelecimento + '(1/2)', valor: valoresDivididos });
			} else if (pessoaNome.toLocaleLowerCase() === 'matheus') {
				dadosMatheus.push({ estabelecimento: nomeEstabelecimento + '(1/2)', valor: valoresDivididos });
			}
			message += `Entrada adicionada a ${pessoaNome}: ${nomeEstabelecimento} - R$ ${valoresDivididos.toFixed(2)}\n`;
		}

		// pessoa.forEach((pessoaNome) => {
		// 	if (pessoaNome.toLocaleLowerCase() === 'jhonatan') {
		// 		dadosJhonatan.push({ estabelecimento: nomeEstabelecimento + '(1/2)', valor: valoresDivididos });
		// 	} else if (pessoaNome.toLocaleLowerCase() === 'matheus') {
		// 		dadosMatheus.push({ estabelecimento: nomeEstabelecimento + '(1/2)', valor: valoresDivididos });
		// 	}
		// 	message += `Entrada adicionada a ${pessoaNome}: ${nomeEstabelecimento} - R$ ${valoresDivididos.toFixed(2)}\n`;
		// });
		nextRow = globalDataCSV.pop(); // Pega a próxima entrada ou null se não houver mais
		
		return { message, nextRow };

	}

	catch (error) {
		dadosJhonatan = [];
		dadosMatheus = [];
		console.error(`Erro ao processar a entrada para as pessoas ${pessoa}:`, error);
		throw new Error(`Erro ao processar a entrada. Por favor, tente novamente.`);
	}

	//return { message, nextRow };
}

function removeElementFromArray<T>(array: T[], element: T) {
	const index = array.indexOf(element);
	if (index > -1) {
		array.splice(index, 1);
	}
}

async function formatarEnviarParaGoogleSheets() {
	if (dadosJhonatan.length > 0 || dadosMatheus.length > 0) {
		try {
			//const entradasJhonatan = dadosJhonatan.map(dado => ({ estabelecimento: dado.estabelecimento, valor: dado.valor }));
			//const entradasMatheus = dadosMatheus.map(dado => ({ estabelecimento: dado.estabelecimento, valor: dado.valor }));

			const dadosFormatados: sheetData[] = [{
				pessoa: 'jhonatan',
				dados: [
					{
						banco: banco.toString(),
						mes: mes,
						ano: ano,
						entradas: dadosJhonatan
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
						entradas: dadosMatheus
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
		{ nome: 'Ignorar essa entrada', valor: 'ignorarEntrada' },
		{ nome: 'Cancelar', valor: 'cancelarProcessamento' }
	];
	ctx.reply(`Selecione o que fazer com a próxima entrada\nEstabelecimento: ${currentCSVRow!.Estabelecimento} Preço: R$${currentCSVRow!.Valor} Data: ${currentCSVRow?.Data}`, Markup.inlineKeyboard(makeSequencButtons(sequence, 1)));
}

async function startBot() {
	bot.use(session());

	bot.use((ctx, next) => {
		// Inicializa a sessão como um objeto tipado
		ctx.session = ctx.session ?? { AguardandoCapturaDaProximaResposta: false, AcaoAnterior: '' } as UserSessionData;
		return next();
	});

	bot.command('start', async (ctx) => {
		console.log('Opções iniciais.');
		await ctx.reply('Escolha uma opção:', Markup.inlineKeyboard([
			[Markup.button.callback('Escolher Mês', 'escolhaMes')],
			[Markup.button.callback('Escolher Ano', 'escolhaAno')],
			[Markup.button.callback('Escolher Banco', 'escolhaBanco')],
			[Markup.button.callback('Enviar Planilha CSV preenchida', 'enviarPlanilha')],
			[Markup.button.callback('Baixar Modelo de Planilha CSV', 'baixarModelo')],
			[Markup.button.callback('Processar Planilha CSV para o Mês e Ano Definidos', 'processarPlanilha')],
			[Markup.button.callback('Definir separador do arquivo CSV', 'separadorCSV')],
			[Markup.button.callback('Ajuda', 'ajuda')]
		]));
		console.log('Finalizado.');
	});

	bot.action('escolhaMes', async (ctx) => {
		await ctx.answerCbQuery(); // remove o loading
		await ctx.reply('Escolha o Mês que deseja selecionar: ', Markup.inlineKeyboard(makeSequencButtons(listaDeMeses, 2)));
	});

	bot.action(/^mes_(.+)$/, async (ctx) => {

		await ctx.answerCbQuery(); //Remove o loading

		const nomeDoMes: string = ctx.match[1]; // "janeiro", "fevereiro", etc.

		console.log('Mês selecionado:', nomeDoMes);

		mes = nomeDoMes.charAt(0).toUpperCase() + nomeDoMes.slice(1).toLowerCase();

		await ctx.reply(`Mês definido com sucesso: ${nomeDoMes}`);

	});

	bot.action('escolhaAno', async (ctx) => {
		const session = ctx.session as UserSessionData;
		session.AguardandoCapturaDaProximaResposta = true;
		session.AcaoAnterior = 'escolhaAno';


		await ctx.answerCbQuery();
		await ctx.reply('Digite o ano desejado. Exemplo: 2025',);
	});

	bot.action('escolhaBanco', async (ctx) => {
		await ctx.answerCbQuery(); // remove o loading
		await ctx.reply('Escolha o Banco que deseja selecionar: ', Markup.inlineKeyboard(makeSequencButtons(listaDeBancos, 2)));
	});

	bot.action(/^banco_(.+)$/, async (ctx) => {
		await ctx.answerCbQuery(); //Remove o loading

		const nomeBanco: string = ctx.match[1]; // "itau", "nubank", etc.
		banco = Banco[nomeBanco.toLocaleUpperCase() as keyof typeof Banco]; // Converte para o enum Banco usando a string

		await ctx.reply(`Banco definido com sucesso: ${banco.toString()}`);

	});

	bot.action('enviarPlanilha', async (ctx) => {
		const session = ctx.session as UserSessionData;
		ctx.answerCbQuery(); // remove o loading

		if(banco) {
			session.AguardandoCapturaDaProximaResposta = true;
			session.AcaoAnterior = 'enviarPlanilha';

			await ctx.reply('📄 Por favor, envie o arquivo da planilha no formato CSV. O arquivo será armazenado com base no banco selecionado.');
		} else {
			await ctx.reply('❌ Por favor, defina o banco antes de enviar a planilha.');
			console.error('Banco não definido antes de enviar a planilha.');
		}
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
			console.log(banco, mes, ano);
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
					let elementoParaRemoverPlanilha: CSVRow = {} as CSVRow;
					let elementoParaRemoverGoogleSheets: {estabelecimento: string, valor: number} = {} as {estabelecimento: string, valor: number};
					const existeEstabelecimento: boolean = dados.entradas.some(entrada =>
						dataCSV.some(row => {
							if (row.Estabelecimento === entrada.estabelecimento || row.Estabelecimento + '(1/2)' === entrada.estabelecimento) {
								elementoParaRemoverPlanilha = row;
								elementoParaRemoverGoogleSheets = entrada;
								return true;
							} else {
								return false;
							}

						})
					);

					if (existeEstabelecimento) {
						removeElementFromArray(dataCSV, elementoParaRemoverPlanilha);
						removeElementFromArray(dados.entradas, elementoParaRemoverGoogleSheets);
					}
				}

			}

			globalDataCSV = dataCSV; // Armazena os dados CSV globalmente para uso posterior


			if (dataCSV.length > 0) {
				session.AguardandoCapturaDaProximaResposta = true;
				session.AcaoAnterior = 'processarEntrada';
				currentCSVRow = dataCSV.pop()!;

				sendOptionsForEntry(ctx); // Envia as opções para o usuário processar a próxima entrada
			}





		} catch (error) {
			console.error('Erro ao processar a planilha:', error);
			await ctx.reply('❌ Erro ao processar a planilha. Por favor, tente novamente.');
		}
	});

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

	bot.action('ignorarEntrada', async (ctx) => {
		await ctx.answerCbQuery();
		const session = ctx.session as UserSessionData;

		if (session.AcaoAnterior && currentCSVRow) {
			currentCSVRow = globalDataCSV.pop(); // Pega a próxima entrada ou null se não houver mais

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

	bot.action('cancelarProcessamento', async (ctx) => {
		await ctx.answerCbQuery(); // remove o loading
		const session = ctx.session as UserSessionData;
		session.AguardandoCapturaDaProximaResposta = false; // Reseta a flag
		currentCSVRow = null; // Reseta a entrada atual
		dadosJhonatan = []; // Limpa os dados de Jhonatan
		dadosMatheus = []; // Limpa os dados de Matheus

		await ctx.reply('Processamento cancelado. Você pode reiniciar o processo com /start.');
	});

	bot.action('separadorCSV', async (ctx) => {
		await ctx.answerCbQuery(); // remove o loading
		await ctx.reply('Escolha o separador do arquivo CSV: ', Markup.inlineKeyboard(makeSequencButtons(listaDeSeparadoresCSV, 2)));
	});


	bot.action(/^separador_(\w+)$/, async (ctx) => {
		await ctx.answerCbQuery(); //Remove o loading

		const nomeSeparador: string = ctx.match[1]; // "virgula", "pontoVirgula", etc.

		if (nomeSeparador === 'virgula') {
			csvParser.setSeparator(',');
		} else if (nomeSeparador === 'pontoVirgula') {
			csvParser.setSeparator(';');
		}


		ctx.reply(`Separador definido com sucesso: ${nomeSeparador === 'virgula' ? ',' : ';'}`);

	});

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


	bot.launch();
	console.log('Bot started!');
}

export { startBot };