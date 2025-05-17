import { google, sheets_v4 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { JSONClient } from 'google-auth-library/build/src/auth/googleauth';
import * as path from 'path';
import os from 'os';
// Se você usar variáveis de ambiente para o caminho da chave,
// pode precisar de uma lib como 'dotenv' se não estiver em um ambiente que já as carrega (ex: alguns serviços cloud)
 import * as dotenv from 'dotenv';
import { get } from 'http';
 dotenv.config();

 const sheetsClient: Promise<sheets_v4.Sheets> = authenticateServiceAccount(); //colcoar await
 const spreadsheetId: string = '1aGgr3I_xcFEKQGiwyTnxD97hEPWVWFlyoB8g29aFcVU'; // Substitua pelo ID da sua planilha
 const listaDeBancos: string[] = ['itau', 'nubank', 'bancodobrasil', 'picpay', 'nossopay'];

// --- Configuração ---

// O caminho para o arquivo JSON da sua Conta de Serviço baixado do Google Cloud Console.
// É RECOMENDADO carregar este caminho de uma variável de ambiente em produção por segurança.
// Ex: process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE
const KEYFILEPATH: string = path.join(os.homedir(), process.env.INIT_DIR!, process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE!);S 

// Escopos necessários. Para ler e modificar, você precisa do escopo 'spreadsheets'.
// Se for apenas leitura, 'spreadsheets.readonly' é mais restritivo e recomendado.
const SCOPES: string[] = ['https://www.googleapis.com/auth/spreadsheets']; // Permite ler e modificar

// --- Função para obter/modificar dados usando Conta de Serviço ---

/**
 * Obtém uma instância autenticada da Google Sheets API usando uma Conta de Serviço.
 * Esta instância pode ser usada para fazer requisições subsequentes.
 */
async function authenticateServiceAccount(): Promise<sheets_v4.Sheets> {
  // Autentica usando o arquivo JSON da Conta de Serviço e os escopos definidos
  const auth: GoogleAuth<JSONClient> = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: SCOPES,
  });

  // Obtém o cliente autenticado
  const client = await auth.getClient();

  // Retorna a instância do serviço Sheets autenticada
  return google.sheets({ version: 'v4', auth: client as any }); // 'auth: client as any' lida com a tipagem
}

/**
 * Exemplo de como ler dados da planilha.
 */
async function readSheetData(sheetsClient: any, spreadsheetId: string, range: string): Promise<{coluna: string, value: number}[]> {
    try {
            const response = await sheetsClient.spreadsheets.values.get({
                spreadsheetId: spreadsheetId, // O ID da sua planilha
                range: range,               // O intervalo que você quer ler (ex: 'Sheet1!A1:D10')
            });

            const rows = response.data.values;

            let rowsInJSON: {coluna: string, value: number}[] = [];


            for(let row of rows!) {
                rowsInJSON.push({
                    coluna: row[0],
                    value: Number(row[1])
                });
            } 

            return rowsInJSON;
        }

    catch (error) {
        console.error(`Erro ao ler dados do intervalo '${range}':`, error);
        throw error;
    }

} 


function getRangeForSheet(mes: string, ano: string,pessoa: string, banco: string): string {
    let pessoaOffset: number = 0;
    if(pessoa.toLocaleLowerCase() === 'jhonatan') {
        pessoaOffset = 1;
    } else if(pessoa.toLocaleLowerCase() === 'matheus') {
        pessoaOffset = 23;
    }

    let planilhaAlvo: string = `${mes}(${ano})`;

    let bancoOffset: number = 0;

    switch (banco.toLocaleLowerCase()) {
        case 'itau':
            bancoOffset = 2;
            break;
        case 'nubank':
            bancoOffset = 6;
            break;
        case 'bancodobrasil':
            bancoOffset = 10;
            break;
        case 'picpay':
            bancoOffset = 14;
            break;
        case 'nossopay':
            bancoOffset = 18;
            break;
        default:
            break;
    }

    // Exemplo de como construir o range baseado em variáveis
    return `${planilhaAlvo}!B${pessoaOffset+bancoOffset}:BI${pessoaOffset+bancoOffset}`; // Ex: 'Sheet1!A1:D10'
}

async function obterInformacoesPlanilha(mes: string, ano: string, pessoa?: string){
    let dadosPlanilhaFormatadosJSON: { pessoa: string, dados: { banco: string, mes: string, ano: string, entradas: { estabelecimento: string, valor: number }[] }[] }[] = [];
    if(pessoa){
        let dadosPorPessoa:{ banco: string, mes: string, ano: string, entradas: { estabelecimento: string, valor: number }[] }[] = [];

        for(let banco of listaDeBancos) {
            let range: string = getRangeForSheet(mes, ano, pessoa, banco);
            let dadosBrutos = await readSheetData(sheetsClient, spreadsheetId, range);
            let dadosBrutosFormatados: { estabelecimento: string, valor: number }[] = dadosBrutos.map((dado) => {return {estabelecimento: dado.coluna, valor:  dado.value}});
            
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
    } else {
        let pessoas: string[] = ['matheus', 'jhonatan'];
        for(let pessoa in pessoas) {
            let dadosPorPessoa:{ banco: string, mes: string, ano: string, entradas: { estabelecimento: string, valor: number }[] }[] = [];

            for(let banco of listaDeBancos) {
                let range: string = getRangeForSheet(mes, ano, pessoa, banco);
                let dadosBrutos = await readSheetData(sheetsClient, spreadsheetId, range);
                let dadosBrutosFormatados: { estabelecimento: string, valor: number }[] = dadosBrutos.map((dado) => {return {estabelecimento: dado.coluna, valor:  dado.value}});
                
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
        }
    }

    return dadosPlanilhaFormatadosJSON;
} 


/**
 * Exemplo de como escrever dados na planilha.
 */
async function writeSheetData(sheets: any, spreadsheetId: string, range: string, values: any[][]) {
    try {
        const resource = {
            values: values, // Array de arrays com os dados a serem escritos
        };
        const response = await sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId, // O ID da sua planilha
            range: range,               // O intervalo onde escrever (ex: 'Sheet1!A1')
            valueInputOption: 'RAW',    // Como os dados são interpretados (RAW ou USER_ENTERED)
            resource: resource,
        });

        console.log(`Células atualizadas: ${response.data.updatedCells}`);
        console.log(`Linhas atualizadas: ${response.data.updatedRows}`);
        // Outras informações úteis no response.data

    } catch (error) {
        console.error(`Erro ao escrever dados no intervalo '${range}':`, error);
        throw error;
    }
}

async function inserirInformacoesPlanilha(mes: string, ano: string, dadosPlanilhaFormatadosJSON: { pessoa: string, dados: { banco: string, mes: string, ano: string, entradas: { estabelecimento: string, valor: number }[] }[] }[]) {
    for(let dado of dadosPlanilhaFormatadosJSON) {
        let pessoa: string = dado.pessoa;
        let dados: { banco: string, mes: string, ano: string, entradas: { estabelecimento: string, valor: number }[] }[] = dado.dados;

        for(let dadoBanco of dados) {
            let banco: string = dadoBanco.banco;
            let mes: string = dadoBanco.mes;
            let ano: string = dadoBanco.ano;
            let entradas: { estabelecimento: string, valor: number }[] = dadoBanco.entradas;

            let range: string = getRangeForSheet(mes, ano, pessoa, banco);
            let valoresParaEscrever: any[][] = entradas.map((entrada) => [entrada.estabelecimento, entrada.valor]);

            await writeSheetData(sheetsClient, spreadsheetId, range, valoresParaEscrever);
        }
    }
}


// --- Exemplo de Uso no seu Backend ---

async function runSheetsOperations() {
    const meuSpreadsheetId = 'SEU_ID_DA_PLANILHA'; // <-- Substitua pelo ID da sua planilha

    try {
        console.log('Autenticando com Conta de Serviço...');
        const sheetsClient = await authenticateServiceAccount();
        console.log('Autenticação bem-sucedida.');

        // Exemplo de leitura
        const dadosLidos = await readSheetData(sheetsClient, meuSpreadsheetId, 'Sheet1!A1:D10');
        console.log('Dados lidos:', dadosLidos);

        // Exemplo de escrita (escreve "Hello", "World" na Sheet1!A1)
        const dadosParaEscrever = [['Hello', 'World']];
        await writeSheetData(sheetsClient, meuSpreadsheetId, 'Sheet1!A1', dadosParaEscrever);
        console.log('Dados escritos na planilha.');

        // Você pode chamar readSheetData novamente para ver a mudança
        const dadosAposEscrever = await readSheetData(sheetsClient, meuSpreadsheetId, 'Sheet1!A1:B1');
        console.log('Dados após escrita:', dadosAposEscrever);


    } catch (err) {
        console.error('Falha geral nas operações do Sheets:', err);
    }
}
