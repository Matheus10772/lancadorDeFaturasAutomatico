import express, { Request, Response } from 'express';
import { validarToken } from './tokenService';
import { processarNotificacaoExterna, getWebhookCallback, iniciarFilaReprocess } from './botLoadService';

// --- Interfaces ---

interface PendingReprocessItem {
	texto: string;
	banco: string;
}

// --- Funções auxiliares ---

/**
 * Recebe um JSON mal-formado (objetos separados por vírgula sem array wrapper)
 * e corrige envolvendo em colchetes e removendo trailing commas.
 *
 * Exemplo de entrada:
 * ```
 * { "texto": "abc", "banco": "Nu" },{ "texto": "def", "banco": "Itau" },
 * ```
 *
 * Resultado: array de objetos parseados.
 */
function corrigirEParsearJson(raw: string): PendingReprocessItem[] {
	let corrigido = raw.trim();

	// Se já começa com '[', tenta parsear direto
	if (!corrigido.startsWith('[')) {
		corrigido = `[${corrigido}]`;
	}

	// Remove vírgula(s) final(is) antes do ']'
	corrigido = corrigido.replace(/[\n]/g, '');
	corrigido = corrigido.replace(/,\s*\]$/, ']');

	return JSON.parse(corrigido) as PendingReprocessItem[];
}

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
		console.error('Token de autenticação não fornecido no header Authorization.');
		return;
	}

	const token = authHeader.replace('Bearer ', '');
	const tokenValido = await validarToken(token);
	if (!tokenValido) {
		res.status(401).json({ erro: 'Token de autenticação inválido.' });
		console.error('Token de autenticação inválido fornecido no header Authorization.');
		return;
	}

	// 2. Validar body
	const banco = req.body?.banco;
	const texto = req.body?.texto;
	if (!texto || typeof texto !== 'string' || texto.trim() === '') {
		res.status(400).json({ erro: 'Campo "texto" é obrigatório e deve ser uma string não vazia.' });
		console.error('Campo "texto" ausente ou inválido no body da requisição.');
		return;
	}

	// 3. Validar que TELEGRAM_CHAT_ID está configurado
	if (!TELEGRAM_CHAT_ID || isNaN(TELEGRAM_CHAT_ID)) {
		console.error('TELEGRAM_CHAT_ID não está configurado ou é inválido.');
		res.status(500).json({ erro: 'Configuração do servidor incompleta: TELEGRAM_CHAT_ID não definido.' });
		console.error('TELEGRAM_CHAT_ID não está configurado ou é inválido.');
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
			console.error('Não foi possível extrair informações do texto recebido do MacroDroid.');
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

		console.log(`Notificação recebida do MacroDroid e enviada para o Telegram: ${JSON.stringify(dados)}`);
	} catch (error) {
		console.error('Erro ao processar notificação via HTTP:', error);
		res.status(500).json({ erro: 'Erro interno ao processar a notificação.' });
	}
});

app.post('/reprocess-pending', express.text({ type: '*/*' }), async (req: Request, res: Response): Promise<void> => {
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

	// 2. Validar que TELEGRAM_CHAT_ID está configurado
	if (!TELEGRAM_CHAT_ID || isNaN(TELEGRAM_CHAT_ID)) {
		console.error('TELEGRAM_CHAT_ID não está configurado ou é inválido.');
		res.status(500).json({ erro: 'Configuração do servidor incompleta: TELEGRAM_CHAT_ID não definido.' });
		return;
	}

	// 3. Obter e corrigir o JSON mal-formado
	const rawBody = typeof req.body === 'string' ? req.body : String(req.body);
	if (!rawBody || rawBody.trim() === '') {
		res.status(400).json({ erro: 'Body é obrigatório e deve conter os itens a reprocessar.' });
		return;
	}

	let itens: PendingReprocessItem[];
	try {
		itens = corrigirEParsearJson(rawBody);
	} catch (error) {
		console.error('Erro ao parsear JSON corrigido:', error);
		res.status(400).json({
			erro: 'Não foi possível parsear o JSON mesmo após correção.',
			detalhe: error instanceof Error ? error.message : String(error),
		});
		return;
	}

	// 4. Filtrar itens com texto vazio
	const itensValidos = itens.filter(item => item.texto && item.texto.trim() !== '');

	if (itensValidos.length === 0) {
		res.status(422).json({ erro: 'Nenhum item com texto válido encontrado no JSON.' });
		return;
	}

	// 5. Envia a fila para processamento no Telegram
	try {
		await iniciarFilaReprocess(TELEGRAM_CHAT_ID, itensValidos);

		res.status(200).json({
			mensagem: `Recebidos ${itensValidos.length} item(ns) para reprocessamento. Enviado ao Telegram para confirmação.`,
			totalRecebidos: itens.length,
			totalValidos: itensValidos.length,
			totalDescartados: itens.length - itensValidos.length,
			status: 200
		});
	} catch (error) {
		console.error('Erro ao iniciar reprocessamento:', error);
		res.status(500).json({ erro: 'Erro interno ao iniciar o reprocessamento.' });
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

export { app, startServer, corrigirEParsearJson };