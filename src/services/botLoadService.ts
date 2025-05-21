import dotenv from 'dotenv';
dotenv.config();

import { Context, Markup, Telegraf } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';
import { message } from 'telegraf/filters';

const bot: Telegraf<Context<Update>> = new Telegraf(process.env.BOT_TOKEN!)

let mes: string;
let ano: string;

interface sequenceOfOptionsButtons {
  nome: string;
  valor: string;
}

const listaDeMeses: sequenceOfOptionsButtons[] = [
  { nome: 'Janeiro', valor: 'mes_janeiro' },
  { nome: 'Fevereiro', valor: 'mes_fevereiro' },
  { nome: 'Março', valor: 'mes_marco' },
  { nome: 'Abril', valor: 'mes_abri' },
  { nome: 'Maio', valor: 'mes_maio' },
  { nome: 'Junho', valor: 'mes_junho' },
  { nome: 'Julho', valor: 'mes_julho' },
  { nome: 'Agosto', valor: 'mes_agosto' },
  { nome: 'Setembro', valor: 'mes_setembro' },
  { nome: 'Outubro', valor: 'mes_outubro' },
  { nome: 'Novembro', valor: 'mes_novembro' },
  { nome: 'Dezembro', valor: 'mes_dezembro' }
];

function makeSequencButtons(Conjunto: sequenceOfOptionsButtons[], quantiadePorLinha: number): any{

  let ConjuntoFormatado = Conjunto.map(botao => Markup.button.callback(botao.nome!, botao.valor!));

  return ConjuntoFormatado.reduce<ReturnType<typeof Markup.button.callback>[][]>((agregado, _, index) => {
    if (index % quantiadePorLinha === 0) agregado.push(ConjuntoFormatado.slice(index, index + quantiadePorLinha));
    return agregado;
  }, []);

}



bot.command('start', async (ctx) => {
    await ctx.reply('Escolha uma opção:', Markup.inlineKeyboard([
    [Markup.button.callback('Escolher Mês', 'escolhaMes')],
    [Markup.button.callback('Escolher Ano', 'escolhaAno')],
    [Markup.button.callback('Enviar Planilha CSV preenchida', 'enviarPlanilha')],
    [Markup.button.callback('Baixar Modelo de Planilha CSV', 'baixarModelo')],
    [Markup.button.callback('Processar Planilha CSV para o Mês e Ano Definidos', 'processarPlanilha')],
    [Markup.button.callback('Ajuda', 'ajuda')],
  ]));
});

// Responder ao botão "Opção 1"
bot.action('escolhaMes', async (ctx) => {
  await ctx.answerCbQuery(); // remove o loading
  

  await ctx.reply( 'Escolha o Mês que deseja selecionar: ', Markup.inlineKeyboard( makeSequencButtons(listaDeMeses, 2) ) );
});

// Responder ao botão "Opção 2"
bot.action('escolhaAno', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Digite o ano desejado:', );
});

// Responder ao botão "Ajuda"
bot.action('ajuda', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Este é um bot de exemplo. Use /start para recomeçar.');
});



bot.launch();

console.log('Bot started!');

