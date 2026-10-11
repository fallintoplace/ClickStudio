FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# The first offline delivery has no generated lock; commit one after npm install.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build:app

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/.data
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Setup is an explicit one-shot command, not a startup migration with administrator access.
COPY --from=build --chown=node:node /app/scripts/seed.ts ./scripts/seed.ts
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 8080
CMD ["node", "dist/src/backend/app/start.js"]
