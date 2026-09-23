import { startBot } from './src/services/botLoadService';
import { startServer } from './src/services/receiveText';

async function startBotWithRetry() {
    while (true) {
        try {
            await startBot();
            break;
        } catch (error) {
            console.error('Erro desconhecido:', error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

async function main() {
    await startBotWithRetry();
    await startServer();
}

main();
