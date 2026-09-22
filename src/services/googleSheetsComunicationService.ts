import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { JSONClient } from 'google-auth-library/build/src/auth/googleauth';
import * as path from 'path';
import os from 'os';
import * as dotenv from 'dotenv';
dotenv.config();


// --- Interfaces ---

interface sheetData {
	banco: string;
	mes: string;
	ano: string;
	entradas: { estabelecimento: string; valor: number }[];
}

// --- Mapeamento de meses para colunas ---

// Cada mês ocupa 2 colunas: Estabelecimento + Valor.
// outubro/2026 = colunas A-B, novembro/2026 = colunas C-D, etc.
// Linha 4 = cabeçalhos mês/ano, linha 5 = sub-headers, dados começam na linha 6.
const MESES_ORDEM: string[] = [
	'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
	'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
];

const LETRAS_COLUNA: string[] = [
	'A','B','C','D','E','F','G','H','I','J','K','L',
	'M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'
];

const ANO_BASE = 2026;
const MES_BASE_INDEX = 9; // outubro = índice 9 em MESES_ORDEM (0-based)
const COLUNAS_POR_MES = 2; // Estabelecimento + Valor
const COLUNA_BASE_INDEX = 0; // outubro/2026 começa na coluna A (índice 0)

const LINHA_DADOS_INICIO = 6; // dados começam na linha 6


class GoogleSheetsComunicationService {
	private spreadsheetId: string;
	private KEYFILEPATH: string;
	private SCOPES: string[];

	constructor() {
		this.spreadsheetId = '1aGgr3I_xcFEKQGiwyTnxD97hEPWVWFlyoB8g29aFcVU';
		this.KEYFILEPATH = path.join(os.homedir(), process.env.INIT_DIR!, process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE!);
		this.SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
	}

	// --- Autenticação ---

	private async authenticateServiceAccount(): Promise<sheets_v4.Sheets> {
		const auth: GoogleAuth<JSONClient> = new google.auth.GoogleAuth({
			keyFile: this.KEYFILEPATH,
			scopes: this.SCOPES,
		});
		const client = await auth.getClient();
		return google.sheets({ version: 'v4', auth: client as any });
	}

	// --- Helpers ---

	/** Retorna o nome da aba com base no banco. Ex: "nubank" → "Var_nubank" */
	private getNomeAba(banco: string): string {
		return `Var_${banco.toLowerCase()}`;
	}

	/** Retorna as letras das 2 colunas (Estabelecimento + Valor) para o mês/ano */
	private getColunasMes(mes: string, ano: string): { colunaEstabelecimento: string; colunaValor: string } {
		const mesIndex = MESES_ORDEM.indexOf(mes.toLowerCase());
		if (mesIndex === -1) throw new Error(`Mês inválido: ${mes}`);

		// Calcula quantos meses de distância do ponto base (outubro/2026)
		const anoNum = Number(ano);
		const mesesDesdeBase = (anoNum - ANO_BASE) * 12 + (mesIndex - MES_BASE_INDEX);

		if (mesesDesdeBase < 0) throw new Error(`Data ${mes}/${ano} é anterior ao início da planilha (outubro/2026)`);

		const colunaEstabIndex = COLUNA_BASE_INDEX + (mesesDesdeBase * COLUNAS_POR_MES);
		const colunaValorIndex = colunaEstabIndex + 1;

		if (colunaValorIndex >= LETRAS_COLUNA.length) throw new Error(`Data ${mes}/${ano} excede as colunas disponíveis`);

		return {
			colunaEstabelecimento: LETRAS_COLUNA[colunaEstabIndex],
			colunaValor: LETRAS_COLUNA[colunaValorIndex],
		};
	}

	// --- Leitura ---

	/**
	 * Lê os dados de um mês/ano/banco da planilha.
	 * Cada mês tem 2 colunas lado a lado: Estabelecimento + Valor.
	 */
	public async obterInformacoesPlanilha(mes: string, ano: string, banco: string): Promise<sheetData> {
		try {
			const aba = this.getNomeAba(banco);
			const { colunaEstabelecimento, colunaValor } = this.getColunasMes(mes, ano);
			const linhaFim = 100;

			// Lê as 2 colunas do mês de uma vez (ex: A6:B100)
			const range = `${aba}!${colunaEstabelecimento}${LINHA_DADOS_INICIO}:${colunaValor}${linhaFim}`;

			const sheets = await this.authenticateServiceAccount();
			const response = await sheets.spreadsheets.values.get({
				spreadsheetId: this.spreadsheetId,
				range: range,
			});

			const linhas = response.data.values ?? [];
			const entradas: { estabelecimento: string; valor: number }[] = [];

			for (const linha of linhas) {
				const nome = linha?.[0];
				if (!nome || String(nome).trim() === '') continue;

				const valorStr = linha?.[1] ?? '0';
				const valor = Number(
					String(valorStr).replace('R$ ', '').replace('.', '').replace(',', '.')
				);

				entradas.push({ estabelecimento: nome, valor: isNaN(valor) ? 0 : valor });
			}

			return { banco, mes, ano, entradas };

		} catch (error) {
			console.error(`Erro ao obter informações da planilha para ${banco} ${mes}/${ano}:`, error);
			throw error;
		}
	}

	// --- Escrita ---

	/**
	 * Insere os dados na planilha.
	 * Escreve nas 2 colunas do mês (Estabelecimento + Valor),
	 * a partir da primeira linha vazia após os dados existentes.
	 */
	public async inserirInformacoesPlanilha(dados: sheetData): Promise<void> {
		try {
			const aba = this.getNomeAba(dados.banco);
			const { colunaEstabelecimento, colunaValor } = this.getColunasMes(dados.mes, dados.ano);

			// Descobre a próxima linha vazia nas colunas desse mês
			const linhaInicio = await this.encontrarProximaLinhaVazia(aba, colunaEstabelecimento);

			const sheets = await this.authenticateServiceAccount();

			// Cada entrada vira uma linha com 2 colunas: [estabelecimento, valor]
			const valores: any[][] = dados.entradas.map(dado => [dado.estabelecimento, dado.valor]);

			const range = `${aba}!${colunaEstabelecimento}${linhaInicio}:${colunaValor}${linhaInicio + dados.entradas.length - 1}`;

			await sheets.spreadsheets.values.update({
				spreadsheetId: this.spreadsheetId,
				range: range,
				valueInputOption: 'USER_ENTERED',
				requestBody: { values: valores },
			});

			console.log(`Inseridas ${dados.entradas.length} entradas em ${aba}, colunas ${colunaEstabelecimento}-${colunaValor}, a partir da linha ${linhaInicio}`);

		} catch (error) {
			console.error(`Erro ao inserir dados na planilha:`, error);
			throw error;
		}
	}

	/**
	 * Insere uma única entrada na planilha.
	 * Método simplificado para uso com o bot de notificações.
	 */
	public async inserirEntradaUnica(banco: string, mes: string, ano: string, estabelecimento: string, valor: number): Promise<void> {
		const dados: sheetData = {
			banco,
			mes,
			ano,
			entradas: [{ estabelecimento, valor }],
		};
		await this.inserirInformacoesPlanilha(dados);
	}

	/** Encontra a próxima linha vazia na coluna especificada da aba */
	private async encontrarProximaLinhaVazia(aba: string, coluna: string): Promise<number> {
		try {
			const sheets = await this.authenticateServiceAccount();
			const range = `${aba}!${coluna}${LINHA_DADOS_INICIO}:${coluna}100`;

			const response = await sheets.spreadsheets.values.get({
				spreadsheetId: this.spreadsheetId,
				range: range,
			});

			const valores = response.data.values ?? [];

			// Conta quantas linhas têm conteúdo
			let ultimaLinhaComDado = 0;
			for (let i = 0; i < valores.length; i++) {
				if (valores[i]?.[0] && String(valores[i][0]).trim() !== '') {
					ultimaLinhaComDado = i + 1;
				}
			}

			return LINHA_DADOS_INICIO + ultimaLinhaComDado;

		} catch (error) {
			console.error(`Erro ao encontrar próxima linha vazia em ${aba}:`, error);
			return LINHA_DADOS_INICIO; // Fallback: começa na primeira linha de dados
		}
	}
}

export { sheetData, GoogleSheetsComunicationService };
