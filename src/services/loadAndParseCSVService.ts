import os from 'os';
import path from 'path';
import fs, { ReadStream } from 'fs';
import csv from 'csv-parser';
import https from 'https';
import Stream from 'stream';
import { file } from 'googleapis/build/src/apis/file';

const dataDir: string = path.join(os.homedir(), process.env.INIT_DIR! );

enum Banco {
    NUBANK,
    ITAU,
    PICPAY,
    NOSSOPAY,
    BANCODOBRASIL
}

enum Enconding {
    UTF8
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
        try {
            return fs.createReadStream(filePath);
        } catch (error) {
            throw new Error(`Error reading file: ${error}`);
        }
    }

    public async parseCSVtoJSON(banco: Banco, mes: string) {
        const filePath = path.join(this.basePath, banco.toString(), `${mes}/faturaConvertida/fatura.csv`);
        const fileStream = await this.getFileStream(filePath);

        const results: any[] = [];
        await fileStream
            .pipe(csv({separator: ';', skipLines: this.csvSkipLines}))
            .on('data', (data) => results.push(data))
            .on('error', (error) => {
                throw new Error(`Error parsing CSV: ${error}`);
            });
        
        return results;
    }

    public async writeCSVtoFile(banco: Banco, mes: string, ano: string,fileLink: string): Promise<string> {
        let result: string = '';

        const filePath = path.join(this.basePath, banco.toString(), `${mes}/faturaConvertida/fatura.csv`);
        const fileStream = fs.createWriteStream(filePath, { encoding: 'utf8' });

        const fileURL = new URL(fileLink);

        https.get(fileURL, (response) => {
            if(response.statusCode !== 200) {
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
    
        if(!fs.existsSync(this.exampleCSVPath))
            throw new Error('Arquivo de exemplo não encontrado');    
        
        return this.exampleCSVPath;
    
            
    }

}

export default CSVParser;
export { Banco, Enconding };