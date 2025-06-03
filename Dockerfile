# Etapa 1: Compilar o TypeScript
FROM node:18-slim AS builder

# Diretório de trabalho da aplicação
WORKDIR /app

# Copia arquivos essenciais
COPY package*.json ./

# Instala as dependências (com as de desenvolvimento)
RUN npm install

# Copia o restante do código-fonte
COPY tsconfig.json ./
COPY src ./src

# Compila TypeScript
RUN npm run build

# Etapa 2: Imagem leve para produção
FROM node:18-slim

# Cria diretório persistente no local esperado pela aplicação
RUN mkdir -p /home/node/.lancadorDeFaturaAutomatico/faturas \
    && mkdir -p /home/node/.lancadorDeFaturaAutomatico/resources

# Diretório de execução
WORKDIR /app

# Copia os arquivos necessários da etapa de build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Instala apenas dependências de produção
RUN npm install --omit=dev

# Copia recursos necessários da máquina host (usados no docker-compose via volume)
# A pasta resources será montada por volume no docker-compose

# Comando de inicialização
CMD ["node", "dist/index.js"]
