# Single image used by both the web app and the background worker.
# Kept deliberately simple (full node_modules) — easy to maintain and migrate.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Dummy DATABASE_URL satisfies env validation during build; runtime value comes from docker-compose.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Overridden per-service in docker-compose.yml.
CMD ["npm", "start"]
