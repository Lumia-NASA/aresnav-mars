# syntax=docker/dockerfile:1.4
FROM node:20-alpine AS base

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

COPY server.js calc.js team.env ./
COPY data/ ./data/

RUN chown -R node:node /usr/src/app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
