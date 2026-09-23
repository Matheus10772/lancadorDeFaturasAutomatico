import { startBot, setupWebhook } from './src/services/botLoadService';
import { startServer } from './src/services/receiveText';

async function main() {
    // 1. Configura os handlers do bot (middleware, actions, etc.)
    await startBot();

    // 2. Inicia o servidor Express (que recebe tanto o webhook do Telegram quanto o do MacroDroid)
    await startServer();

    // 3. Registra o webhook no Telegram (precisa do servidor já rodando)
    await setupWebhook();

    console.log('Aplicação iniciada com sucesso (modo webhook).');
}

main().catch((error) => {
    console.error('Erro fatal ao iniciar a aplicação:', error);
    process.exit(1);
});
