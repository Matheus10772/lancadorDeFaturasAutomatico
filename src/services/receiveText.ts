import express, { Request, Response } from 'express';
import { validarToken } from './tokenService';
import { processarNotificacaoExterna, getWebhookCallback } from './botLoadService';

// --- Configuração ---

const app = express();
app.use(express.json());

// --- Rota: Webhook do Telegram (path secreto + validação de secret_token) ---
const webhookConfig = getWebhookCallback();
app.post(webhookConfig.path, webhookConfig.handler);

const TELEGRAM_CHAT_ID = Number(process.env.TELEGRAM_CHAT_ID);

// --- Rota: Receber notificação do MacroDroid ---

app.post('/webhook-macrodroid', async (req: Request, res: Response): Promise<void> => {
	// 1. Validar autenticação
	const authHeader = req.headers.authorization;
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		res.status(401).json({ erro: 'Token de autenticação não fornecido. Use o header Authorization: Bearer <token>' });
		return;
	}

	const token = authHeader.replace('Bearer ', '');
	const tokenValido = await validarToken(token);
	if (!tokenValido) {
		res.status(401).json({ erro: 'Token de autenticação inválido.' });
		return;
	}

	// 2. Validar body
	const banco = req.body?.banco;
	const texto = req.body?.texto;
	if (!texto || typeof texto !== 'string' || texto.trim() === '') {
		res.status(400).json({ erro: 'Campo "texto" é obrigatório e deve ser uma string não vazia.' });
		return;
	}

	// 3. Validar que TELEGRAM_CHAT_ID está configurado
	if (!TELEGRAM_CHAT_ID || isNaN(TELEGRAM_CHAT_ID)) {
		console.error('TELEGRAM_CHAT_ID não está configurado ou é inválido.');
		res.status(500).json({ erro: 'Configuração do servidor incompleta: TELEGRAM_CHAT_ID não definido.' });
		return;
	}

	// 4. Processar e enviar menu de confirmação ao Telegram
	try {
		const dados = await processarNotificacaoExterna(TELEGRAM_CHAT_ID, texto.trim(), banco);

		if (!dados) {
			res.status(422).json({
				erro: 'Não foi possível extrair informações do texto.',
				detalhe: 'Certifique-se de que o texto contém o valor (R$) e o nome do estabelecimento.',
			});
			return;
		}

		res.status(200).json({
			mensagem: 'Notificação recebida e enviada para confirmação no Telegram.',
			dados: {
				estabelecimento: dados.estabelecimento,
				valor: dados.valor,
				data: dados.data,
				banco: dados.banco,
			},
		});
	} catch (error) {
		console.error('Erro ao processar notificação via HTTP:', error);
		res.status(500).json({ erro: 'Erro interno ao processar a notificação.' });
	}
});

// --- Iniciar servidor ---

function startServer(porta: number = 3000): Promise<void> {
	return new Promise((resolve) => {
		app.listen(porta, () => {
			console.log(`Servidor HTTP rodando na porta ${porta}`);
			resolve();
		});
	});
}

export { app, startServer };