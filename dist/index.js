"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const telegraf_1 = require("telegraf");
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
// bot.on(message("text"), async (ctx) => {
//     console.log(ctx.message.text);
//     ctx.reply('Hello! I am a bot. How can I help you?');
// });
bot.command('start', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply('Escolha uma opção:', telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('Opção 1', 'opcao_1')],
        [telegraf_1.Markup.button.callback('Opção 2', 'opcao_2')],
        [telegraf_1.Markup.button.callback('Ajuda', 'ajuda')],
    ]));
}));
// Responder ao botão "Opção 1"
bot.action('opcao_1', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.answerCbQuery(); // remove o loading
    yield ctx.reply('Você escolheu a opção 1!');
}));
// Responder ao botão "Opção 2"
bot.action('opcao_2', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.answerCbQuery();
    yield ctx.reply('Você escolheu a opção 2!');
}));
// Responder ao botão "Ajuda"
bot.action('ajuda', (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    yield ctx.reply('Este é um bot de exemplo. Use /start para recomeçar.');
}));
bot.launch();
console.log('Bot started!');
