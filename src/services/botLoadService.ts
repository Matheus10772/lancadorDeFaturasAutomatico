import dotenv from 'dotenv';
dotenv.config();

import { Markup, Telegraf } from 'telegraf';
import CSVParserClass from './loadAndParseCSVService';
import { Banco, Enconding } from './loadAndParseCSVService';
import https from 'https';
import { Update } from 'telegraf/typings/core/types/typegram';
import { message } from 'telegraf/filters';
import { session } from 'telegraf';

// Extend the context to include session
import { Context as TelegrafContext } from 'telegraf';
import path from 'path';

interface MyContext extends TelegrafContext {
  session?: UserSessionData;
}

const bot: Telegraf<MyContext> = new Telegraf(process.env.BOT_TOKEN!)
const csvParser: CSVParserClass = new CSVParserClass();

let mes: string;
let ano: string;
let banco: Banco;

interface sequenceOfOptionsButtons {
  nome: string;
  valor: string;
}

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

interface UserSessionData {
  AguardandoCapturaDaProximaResposta: boolean;
  AcaoAnterior: string;
}

function makeSequencButtons(Conjunto: sequenceOfOptionsButtons[], quantiadePorLinha: number): any{

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
     const message: string =  await checkActionToDo(ctx.message.text, session);
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
  await ctx.reply( 'Escolha o Mês que deseja selecionar: ', Markup.inlineKeyboard( makeSequencButtons(listaDeMeses, 2) ) );
});

bot.action(/^mes_(\w+)$/, async (ctx) => {
  await ctx.answerCbQuery(); //Remove o loading
  
  const nomeDoMes: string = ctx.match[1]; // "janeiro", "fevereiro", etc.

  mes = nomeDoMes;

  await ctx.reply(`Mês definido com sucesso: ${nomeDoMes}`);

});

bot.action('escolhaBanco', async (ctx) => {
  await ctx.answerCbQuery(); // remove o loading
  await ctx.reply( 'Escolha o Banco que deseja selecionar: ', Markup.inlineKeyboard( makeSequencButtons(listaDeBancos, 2) ) );
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
  await ctx.reply('Digite o ano desejado. Exemplo: 2025', );
});


bot.use((ctx, next) => {
  // Inicializa a sessão como um objeto tipado
  ctx.session = ctx.session ?? {AguardandoCapturaDaProximaResposta: true} as UserSessionData;
  return next();
});


bot.action('enviarPlanilha', async (ctx) => {
  const session = ctx.session as UserSessionData;
  session.AguardandoCapturaDaProximaResposta = true;
  session.AcaoAnterior = 'enviarPlanilha';


  await ctx.answerCbQuery(); // remove o loading
  await ctx.reply( '📄 Por favor, envie o arquivo da planilha no formato CSV. O arquivo será armazenado com base no banco selecionado.');

});

bot.on('document', async (ctx) => {
  const file = ctx.message.document;
  const session = ctx.session as UserSessionData;

  try {
    if(session.AguardandoCapturaDaProximaResposta) {
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





bot.launch();

console.log('Bot started!');

