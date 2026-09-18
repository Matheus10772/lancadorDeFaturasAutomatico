import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { JSONClient } from 'google-auth-library/build/src/auth/googleauth';
import * as path from 'path';
import os from 'os';

// Se você usar variáveis de ambiente para o caminho da chave,
// pode precisar de uma lib como 'dotenv' se não estiver em um ambiente que já as carrega (ex: alguns serviços cloud)
import * as dotenv from 'dotenv';
import { get } from 'http';
import { Banco } from './loadAndParseCSVService';
dotenv.config();


interface sheetData {
    banco: string,
    mes: string,
    ano: string,
    entradas: {
        estabelecimento: string,
        valor: number
    }[]
}

interface rawSheetData { 
    coluna: string, 
    value: number 
}




class GoogleSheetsComunicationService {
    //private sheetsClient: Promise<sheets_v4.Sheets>;
    private spreadsheetId: string;// Substitua pelo ID da sua planilha
    private listaDeBancos: string[];

    // --- Configuração ---

    // O caminho para o arquivo JSON da sua Conta de Serviço baixado do Google Cloud Console.
    // É RECOMENDADO carregar este caminho de uma variável de ambiente em produção por segurança.
    // Ex: process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE
    private KEYFILEPATH: string;

    // Escopos necessários. Para ler e modificar, você precisa do escopo 'spreadsheets'.
    // Se for apenas leitura, 'spreadsheets.readonly' é mais restritivo e recomendado.
    private SCOPES: string[];

    constructor() {
        //this.sheetsClient = this.authenticateServiceAccount();
        // Aguarda a autenticação ser concluída antes de prosseguir
        // (caso precise garantir em algum método, use: await this.sheetsClient)
        this.spreadsheetId = '1aGgr3I_xcFEKQGiwyTnxD97hEPWVWFlyoB8g29aFcVU'; // Substitua pelo ID da sua planilha
        this.listaDeBancos = ['itau', 'nubank', 'bancodobrasil', 'picpay', 'nossopay'];
        this.KEYFILEPATH = path.join(os.homedir(), process.env.INIT_DIR!, process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE!);
        this.SCOPES = ['https://www.googleapis.com/auth/spreadsheets']; // Permite ler e modificar

    }

    /**
 * Obtém uma instância autenticada da Google Sheets API usando uma Conta de Serviço.
 * Esta instância pode ser usada para fazer requisições subsequentes.
 */

    private async authenticateServiceAccount(): Promise<sheets_v4.Sheets> {
        // Autentica usando o arquivo JSON da Conta de Serviço e os escopos definidos
        const auth: GoogleAuth<JSONClient> = new google.auth.GoogleAuth({
            keyFile: this.KEYFILEPATH,
            scopes: this.SCOPES,
        });

        // Obtém o cliente autenticado
        const client = await auth.getClient();

        // Retorna a instância do serviço Sheets autenticada
        return google.sheets({ version: 'v4', auth: client as any }); // 'auth: client as any' lida com a tipagem
    }

    /**
    * Método para ler dados de uma planilha do Google Sheets.
    */
    private async readSheetData(range: string): Promise<rawSheetData[]> {
        try {
            const response = await (await this.authenticateServiceAccount()).spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId, // O ID da sua planilha
                range: range,               // O intervalo que você quer ler (ex: 'Sheet1!A1:D10')
            });

            /**Se o intervalo selecionado estiver vazio, 'values' será 'undefined'. CORRIGIR ISSO */
            const datas = response.data.values;

            let rowsInJSON: { coluna: string, value: number }[] = [];

            if(datas && datas.length > 0) {


                const colIndex: number = 0;
                const valueIndex: number = 1;
                const matrixLength: number = datas[0].length;

                for(let index = 0; index < matrixLength; index++) {
                    rowsInJSON.push({
                        coluna: datas[colIndex][index],
                        value: Number(datas[valueIndex][index].replace('R$ ', '').replace(',', '.'))
                    });
                }

            }

            return rowsInJSON;
        }

        catch (error) {
            console.error(`Erro ao ler dados do intervalo '${range}':`, error);
            throw error;
        }

    }

    /**Método que faz uma interface para facilitar o uso da API do google */
    public async obterInformacoesPlanilha(mes: string, ano: string, banco?: Banco[]): Promise<sheetData[]> {
        let dadosPlanilhaFormatadosJSON: sheetData[] = [];
        let listaDeBancos: string[];

        if(!banco) {
            listaDeBancos = this.listaDeBancos;
        } else {
            listaDeBancos = banco.map((banco) => {return banco.toString()});
        }


            for (let banco of listaDeBancos) {
                let range: string = this.getRangeForSheet(mes, ano, banco);
                let dadosBrutos = await this.readSheetData(range);
                let dadosBrutosFormatados: { estabelecimento: string, valor: number }[] = dadosBrutos.map((dado) => { return { estabelecimento: dado.coluna, valor: dado.value } });

                dadosPorPessoa.push({
                    banco: banco,
                    mes: mes,
                    ano: ano,
                    entradas: dadosBrutosFormatados
                });

            }

            dadosPlanilhaFormatadosJSON.push({
                pessoa: pessoa,
                dados: dadosPorPessoa
            });
        

        return dadosPlanilhaFormatadosJSON;
    }


    /**Método para obter o parâmetro range já formatado no padrão necessário para a API do google**/
    private getRangeForSheet(mes: string, ano: string, banco: string): string {

        let planilhaAlvo: string = `Var_(${banco.toLocaleLowerCase()})`;

        let offset: number = 5;

        const lineOffset: number = 100;

        const colunaCorrespondente: string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J','K', 'L', 'M', 'N', 'O', 'P'];

        const defaultOffSetForColum: number = 1;

        let additionalOffset: number = 0;
        if(Number(ano) === 2027) {
            additionalOffset = 3;

            const mapOffsetForMes: Map<string, number>  = new Map<string, number>([
                ['janeiro', 0],
                ['fevereiro', 1],
                ['março', 2],
                ['abril', 3],
                ['maio', 4],
                ['junho', 5],
                ['julho', 6],
                ['agosto', 7],
                ['setembro', 8],
                ['outubro', 9],
                ['novembro', 10],
                ['dezembro', 11]
            ]);

            additionalOffset += mapOffsetForMes.get(mes.toLowerCase()) ?? 0;
        } else if(Number(ano) === 2026) {
            const mapOffsetForMes: Map<string, number>  = new Map<string, number>([
                ['outubro', 0],
                ['novembro', 1],
                ['dezembro', 2]
            ]);
        }

        // Exemplo de como construir o range baseado em variáveis
        return `${planilhaAlvo}!${colunaCorrespondente[(defaultOffSetForColum + additionalOffset)]}${offset}:${colunaCorrespondente[(defaultOffSetForColum + additionalOffset)]}${lineOffset}`; // Ex: 'Sheet1!A1:D10'
    }

    /**
 * Método para escrever dados em uma planilha do Google Sheets.
 */
private async writeSheetData(range: string, values: any[][]) {
    try {

        const response = await (await this.authenticateServiceAccount()).spreadsheets.values.update({
            spreadsheetId: this.spreadsheetId, // O ID da sua planilha
            range: range,               // O intervalo onde escrever (ex: 'Sheet1!A1')
            valueInputOption: 'RAW',    // Como os dados são interpretados (RAW ou USER_ENTERED)
            requestBody: {
                values: values,
            },
        });

        console.log(`Células atualizadas: ${response.data.updatedCells}`);
        console.log(`Linhas atualizadas: ${response.data.updatedRows}`);
        // Outras informações úteis no response.data

    } catch (error) {
        console.error(`Erro ao escrever dados no intervalo '${range}':`, error);
        throw error;
    }
}

/**Método que faz uma interface que facilita o uso da API do google que faz a escrita na planilha do google.*/
    public async inserirInformacoesPlanilha(dadosPlanilhaFormatadosJSON: sheetData[]) {
        for (let dado of dadosPlanilhaFormatadosJSON) {
            let pessoa: string = dado.pessoa;
            let dados: { banco: string, mes: string, ano: string, entradas: { estabelecimento: string, valor: number }[] }[] = dado.dados;

            for (let dadoBanco of dados) {
                let banco: string = dadoBanco.banco;
                let mes: string = dadoBanco.mes;
                let ano: string = dadoBanco.ano;
                let entradas: { estabelecimento: string, valor: number }[] = dadoBanco.entradas;

                let range: string = this.getRangeForSheet(mes, ano, pessoa, banco);

                const estabelecimentos: string[] = [];
                const valores: number[] = [];

                entradas.forEach(entrada => {
                    estabelecimentos.push(entrada.estabelecimento);
                    valores.push(entrada.valor);
                });

                const valoresParaEscrever: any[][] = [estabelecimentos, valores];

                await this.writeSheetData(range, valoresParaEscrever);
            }
        }
    }




}

export { sheetData, GoogleSheetsComunicationService };
