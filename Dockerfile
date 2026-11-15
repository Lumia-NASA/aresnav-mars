# syntax=docker/dockerfile:1.4
# Imagem de porta única para a VPS: o Fastify serve a API e o frontend na porta 3000.
# Construir a partir da raiz do repositório:  docker build -t aresnav .
FROM node:20-alpine AS base

# Reap de processos zumbis e encaminhamento de sinais (PID 1)
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    FRONTEND_DIR=/usr/src/app/frontend
WORKDIR /usr/src/app/backend

# Instalação determinística, sem scripts arbitrários
COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY backend/server.js backend/calc.js backend/team.env ./
COPY backend/data/ ./data/
COPY frontend/ /usr/src/app/frontend/

# Execução sob usuário não-root (UID 1000 / node)
RUN chown -R node:node /usr/src/app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]

# Execução recomendada (skill 06):
#   docker run -d --name aresnav -p 3000:3000 --read-only --tmpfs /tmp \
#     --security-opt=no-new-privileges:true --cap-drop=ALL --user 1000:1000 aresnav
# Com --read-only o cache novo de blocos e fotos não é gravado em disco (o backend segue funcionando).
# Para manter o cache entre reinícios, monte um volume em /usr/src/app/backend/data/cache.
