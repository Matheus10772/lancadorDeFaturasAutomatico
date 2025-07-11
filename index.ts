import { startBot, sendAutonomosMessage } from './src/services/botLoadService';

async function startBotWithRetry() {
    while (true) {
        try {
            await startBot();
            break;
        } catch (error) {
            console.error('Erro desconhecido:', error);
            sendAutonomosMessage(`${error}`);
            await new Promise(resolve => setTimeout(resolve, 5000));  // Espera 5 segundos
        }
    }
}

startBotWithRetry();
