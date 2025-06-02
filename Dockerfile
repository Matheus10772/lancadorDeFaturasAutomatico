# Etapa 1: Build com TypeScript
FROM node:18 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Etapa 2: Imagem leve para produção
FROM node:18-alpine

WORKDIR /home/node/.lancadorDeFaturaAutomatico

# Copia apenas os arquivos necessários
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev

# Copia recursos adicionais no momento do deploy (via volume ou docker-compose)
CMD ["node", "dist/index.js"]