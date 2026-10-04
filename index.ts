import { startBot, setupWebhook } from './src/services/botLoadService';
import { startServer } from './src/services/receiveText';
import { carregarFilasDoDisco, iniciarPersistenciaPeriodica, salvarSeModificada } from './src/services/queueService';

async function main() {
    // 1. Restaura a fila salva em disco (antes de aceitar novos itens via HTTP/Telegram)
    const restaurados = await carregarFilasDoDisco();
    console.log(`Fila restaurada do disco: ${restaurados} item(ns).`);

    // 2. Configura os handlers do bot (middleware, actions, etc.)
    await startBot();

    // 3. Inicia o servidor Express (que recebe tanto o webhook do Telegram quanto o do MacroDroid)
    await startServer();

    // 4. Registra o webhook no Telegram (precisa do servidor já rodando)
    await setupWebhook();

    // 5. Grava a fila em disco a cada 5 minutos (somente se houve alteração)
    iniciarPersistenciaPeriodica();

    console.log('Aplicação iniciada com sucesso (modo webhook).');
}

/** Ao encerrar (Ctrl+C, docker stop), grava as alterações da fila que ainda não foram salvas. */
async function encerrar(sinal: string) {
    console.log(`${sinal} recebido. Salvando a fila antes de encerrar...`);
    try {
        await salvarSeModificada();
    } catch (error) {
        console.error('Erro ao salvar a fila no encerramento:', error);
    }
    process.exit(0);
}

process.once('SIGINT', () => encerrar('SIGINT'));
process.once('SIGTERM', () => encerrar('SIGTERM'));

main().catch((error) => {
    console.error('Erro fatal ao iniciar a aplicação:', error);
    process.exit(1);
});
