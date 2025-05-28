const fs = require('fs');
const csv = require('csv-parser');

async function getFileStream(filePath) {
    try {
        return fs.createReadStream(filePath);
    } catch (error) {
        throw new Error(`Error reading file: ${error}`);
    }
}

async function parseCSVtoJSON(basePath) {
    const fileStream = await getFileStream(basePath);

    const bancoNome = fileStream

    return new Promise((resolve, reject) => {
        const results = [];
        fileStream
            .pipe(csv({separator: ';',encoding: 'utf-8', skipLines: 1}))
            .on('data', (data) => results.push(data))
            .on('end', () => {
                console.log(results);
                resolve(results);
            })
            .on('error', (error) => {
                reject(`Error parsing CSV: ${error}`);
            });
        
    });
}

console.log(parseCSVtoJSON('C:\\Users\\mathe\\Downloads\\extrator-picpay\\extrator-fatura-picpay\\extrator-fatura-picpay\\fatura_picpay_corrigida.csv'));


// const google = require('googleapis').google;


// const path = require('path');
// const os = require('os');
// // Se você usar variáveis de ambiente para o caminho da chave,
// // pode precisar de uma lib como 'dotenv' se não estiver em um ambiente que já as carrega (ex: alguns serviços cloud)
//  const dotenv = require('dotenv');
//  dotenv.config();

// // --- Configuração (Substitua pelos seus valores) ---

// // O caminho para o arquivo JSON da sua Conta de Serviço baixado do Google Cloud Console.
// // É RECOMENDADO carregar este caminho de uma variável de ambiente em produção por segurança.
// // Ex: process.env.GOOGLE_SERVICE_ACCOUNT_KEYFILE
// const KEYFILEPATH= path.join('C:\\Users\\mathe\\Downloads\\bot-telegram-lançadorDeFatura\\resources\\named-territory-282018-98a17fbf8d5b.json'); 

// // Escopos necessários. Para ler e modificar, você precisa do escopo 'spreadsheets'.
// // Se for apenas leitura, 'spreadsheets.readonly' é mais restritivo e recomendado.
// const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']; // Permite ler e modificar

// // --- Função para obter/modificar dados usando Conta de Serviço ---

// /**
//  * Obtém uma instância autenticada da Google Sheets API usando uma Conta de Serviço.
//  * Esta instância pode ser usada para fazer requisições subsequentes.
//  */
// async function authenticateServiceAccount() {
//   // Autentica usando o arquivo JSON da Conta de Serviço e os escopos definidos
//   const auth = new google.auth.GoogleAuth({
//     keyFile: KEYFILEPATH,
//     scopes: SCOPES,
//   });

//   // Obtém o cliente autenticado
//   const client = await auth.getClient();

//   // Retorna a instância do serviço Sheets autenticada
//   return google.sheets({ version: 'v4', auth: client }); // 'auth: client as any' lida com a tipagem
// }

// /**
//  * Exemplo de como ler dados da planilha.
//  */
// async function readSheetData(sheets, spreadsheetId, range) {
//     try {
//         const response = await sheets.spreadsheets.values.get({
//             spreadsheetId: spreadsheetId, // O ID da sua planilha
//             range: range,               // O intervalo que você quer ler (ex: 'Sheet1!A1:D10')
//         });

//         const rows = response.data.values;

//         if (rows && rows.length) {
//             console.log(`Dados obtidos do intervalo '${range}':`);
//             // O formato é um array de arrays
//             // rows.forEach(row => {
//             //   console.log(row.join(', '));
//             // });
//             return rows; // Retorna os dados
//         } else {
//             console.log(`Nenhum dado encontrado no intervalo '${range}'.`);
//             return null;
//         }

//     } catch (error) {
//         console.error(`Erro ao ler dados do intervalo '${range}':`, error);
//         throw error;
//     }
// }

// /**
//  * Exemplo de como escrever dados na planilha.
//  */
// async function writeSheetData(sheets, spreadsheetId, range, values) {
//     try {
//         const resource = {
//             values: values, // Array de arrays com os dados a serem escritos
//         };
//         const response = await sheets.spreadsheets.values.update({
//             spreadsheetId: spreadsheetId, // O ID da sua planilha
//             valueInputOption: 'RAW',    // Como os dados são interpretados (RAW ou USER_ENTERED)
//             resource: resource,
//         });

//         console.log(`Células atualizadas: ${response.data.updatedCells}`);
//         console.log(`Linhas atualizadas: ${response.data.updatedRows}`);
//         // Outras informações úteis no response.data

//     } catch (error) {
//         console.error(`Erro ao escrever dados no intervalo '${range}':`, error);
//         throw error;
//     }
// }


// // --- Exemplo de Uso no seu Backend ---

// async function runSheetsOperations() {
//     const meuSpreadsheetId = '1aGgr3I_xcFEKQGiwyTnxD97hEPWVWFlyoB8g29aFcVU'; // <-- Substitua pelo ID da sua planilha

//     try {
//         console.log('Autenticando com Conta de Serviço...');
//         const sheetsClient = await authenticateServiceAccount();
//         console.log('Autenticação bem-sucedida.');

//         // Exemplo de leitura
//         const dadosLidos = await readSheetData(sheetsClient, meuSpreadsheetId, 'Abril(2025)!B7:P8');
//         console.log('Dados lidos:', dadosLidos);

//         // Exemplo de escrita (escreve "Hello", "World" na Sheet1!A1)
//         // const dadosParaEscrever = [['Hello', 'World']];
//         // await writeSheetData(sheetsClient, meuSpreadsheetId, 'Sheet1!A1', dadosParaEscrever);
//         // console.log('Dados escritos na planilha.');

//         // Você pode chamar readSheetData novamente para ver a mudança
//         // const dadosAposEscrever = await readSheetData(sheetsClient, meuSpreadsheetId, 'Sheet1!A1:B1');
//         // console.log('Dados após escrita:', dadosAposEscrever);


//     } catch (err) {
//         console.error('Falha geral nas operações do Sheets:', err);
//     }
// }

// // Execute as operações
// runSheetsOperations();

// //console.log( authenticateServiceAccount())