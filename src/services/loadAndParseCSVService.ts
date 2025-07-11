import os from 'os';
import path from 'path';
import fs, { ReadStream } from 'fs';
import csv from 'csv-parser';
import https from 'https';
import Stream from 'stream';
import { file } from 'googleapis/build/src/apis/file';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import { normalizeName } from '../utils/padronizacaoDeNomes'

dotenv.config();

const dataDir: string = path.join(os.homedir(), process.env.INIT_DIR!);

enum Banco {
    NUBANK = 'NUBANK',
    ITAU = 'ITAU',
    PICPAY = 'PICPAY',
    NOSSOPAY = 'NOSSOPAY',
    BANCODOBRASIL = 'BANCODOBRASIL'
}

enum Enconding {
    UTF8
}

interface CSVRow {
    Data: string;
    Estabelecimento: string;
    Valor: number;
}

class CSVParser {
    private basePath: string;
    private separator: string;
    private encoding: Enconding;
    private csvSkipLines: number;
    private exampleCSVPath: string;


    constructor() {
        this.basePath = path.join(dataDir, process.env.FATURAS_DIR!);
        this.separator = ';';
        this.encoding = Enconding.UTF8;
        this.csvSkipLines = 1;
        this.exampleCSVPath = path.join(this.basePath, 'example.csv');
    }


    private async getFileStream(filePath: string): Promise<fs.ReadStream> {
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            stream.on('error', reject);
            stream.on('open', () => resolve(stream));
        });
    }

    public async parseCSVtoJSON(banco: Banco, mes: string, ano: string): Promise<CSVRow[]> {
        const filePath = path.join(this.basePath, banco.toString(), `${normalizeName(mes.toLowerCase())}${ano}/faturaConvertida/fatura.csv`);
        const fileStream = await this.getFileStream(filePath);


        const results: CSVRow[] = [];
        await new Promise<void>((resolve, reject) => {
            fileStream
                .pipe(csv({ separator: ';', skipLines: this.csvSkipLines }))
                .on('data', (data) => {
                    results.push({
                        Data: data.Data,
                        Estabelecimento: data.Estabelecimento,
                        Valor: parseFloat((data['Valor (R$)']).replace(',', '.'))
                    })
                })
                .on('end', () => resolve())
                .on('error', (error) => reject(new Error(`Error parsing CSV: ${error}`)));
        });

        return results;
    }

    public async writeCSVtoFile(banco: Banco, mes: string, ano: string, fileLink: string): Promise<string> {
        let result: string = '';

        const filePath = path.join(this.basePath, banco.toString(), `${normalizeName(mes.toLocaleLowerCase())}/faturaConvertida/fatura.csv`);
        const fileStream = fs.createWriteStream(filePath, { encoding: 'utf8' });

        const fileURL = new URL(fileLink);

        https.get(fileURL, (response) => {
            if (response.statusCode !== 200) {
                result = `❌ Erro ao baixar o arquivo: código ${response.statusCode}`;
                return result;
            }

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                result = `✅ Arquivo baixado com sucesso: ${filePath}`;
                return result;

            });


        }).on('error', (error) => {
            result = `❌ Erro ao baixar o arquivo: ${error.message}`;
            return result;
        });

        return result;

    }

    public getExampleCSV(): string {

        if (!fs.existsSync(this.exampleCSVPath))
            throw new Error('Arquivo de exemplo não encontrado');

        return this.exampleCSVPath;


    }

    public getSeprator(): string {
        return this.separator;
    }

    public setSeparator(separator: string): void {
        this.separator = separator;
    }

    public converterFatura(inputArg: string, banco: Banco): string {

        switch (banco) {
            case Banco.NUBANK:
                break;
            case Banco.ITAU:
                break;
            case Banco.PICPAY:
                break;
            default:
                break;
        }
        const processo = spawn('python3', ['script.py', inputArg]);

        processo.stdout.on('data', (data) => {
            console.log(`Saída: ${data}`);
        });

        processo.stderr.on('data', (data) => {
            console.error(`Erro: ${data}`);
        });

        processo.on('close', (code) => {
            console.log(`Processo encerrado com código ${code}`);
        });

        return '';
    }



}

export { CSVParser, Banco, Enconding, CSVRow };