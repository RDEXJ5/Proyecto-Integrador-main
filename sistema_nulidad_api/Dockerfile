FROM node:24-alpine AS production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
