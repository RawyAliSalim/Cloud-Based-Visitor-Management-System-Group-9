# API image for local development and automated tests.
# Production still runs on Vercel (see vercel.json); this image is not deployed.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY server ./server
COPY api ./api
COPY tests ./tests

USER node
EXPOSE 3000
CMD ["node", "server/server.js"]
