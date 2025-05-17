import dotenv from 'dotenv';
dotenv.config();

import { Context, Markup, Telegraf } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';
import { message } from 'telegraf/filters';

const bot: Telegraf<Context<Update>> = new Telegraf(process.env.BOT_TOKEN!)


bot.command('start', async (ctx) => {
    await ctx.reply('Escolha uma opção:', Markup.inlineKeyboard([
    [Markup.button.callback('Opção 1', 'opcao_1')],
    [Markup.button.callback('Opção 2', 'opcao_2')],
    [Markup.button.callback('Ajuda', 'ajuda')],
  ]));
});

// Responder ao botão "Opção 1"
bot.action('opcao_1', async (ctx) => {
  await ctx.answerCbQuery(); // remove o loading
  await ctx.reply('Você escolheu a opção 1!');
});

// Responder ao botão "Opção 2"
bot.action('opcao_2', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Você escolheu a opção 2!');
});

// Responder ao botão "Ajuda"
bot.action('ajuda', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Este é um bot de exemplo. Use /start para recomeçar.');
});



bot.launch();

console.log('Bot started!');

