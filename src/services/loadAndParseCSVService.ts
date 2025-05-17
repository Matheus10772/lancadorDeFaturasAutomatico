import os from 'os';
import path from 'path';
import fs, { ReadStream } from 'fs';
import csv from 'csv-parser';
import Stream from 'stream';

const dataDir: string = path.join(os.homedir(), process.env.INIT_DIR! );

enum Banco {
    NUBANK,
    ITAU,
    PICPAY
}

enum Enconding {
    UTF8
}

class fileReader {
    private basePath: string;
    private separator: string;
    private encoding: Enconding;
    private csvSkipLines: number;


    constructor() {
        this.basePath = path.join(dataDir, process.env.FATURAS_DIR!);
        this.separator = ';';
        this.encoding = Enconding.UTF8;
        this.csvSkipLines = 1;
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

}