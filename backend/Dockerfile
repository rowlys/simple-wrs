# API image (technical spec §11): deps → build → runtime. Build from the repository root:
#   docker build -f backend/Dockerfile .
# The app sits in /app/backend and the contract in /app/docs, the same layout as the repository, so
# dist/main.js finds ../../docs/openapi.yaml for Swagger UI.

# Node >= 22.18 runs prisma/seed.ts by type stripping (D-02).
FROM node:22-alpine AS deps
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
# Runtime dependencies only (prisma is one: migrate deploy runs on start), with the client generated for
# this platform (Alpine, musl).
RUN npm ci --omit=dev && npx prisma generate

FROM node:22-alpine AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate && npm run build

FROM node:22-alpine
# Prisma's engines need OpenSSL.
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=deps /app/backend/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY backend/package.json ./
COPY backend/prisma ./prisma
COPY docs/openapi.yaml /app/docs/openapi.yaml
USER node
EXPOSE 3000
# Spec §3.3 steps 5–6, §11: pending migrations, the seed when SEED_ON_START=true, then the API.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_ON_START\" = \"true\" ]; then npm run seed; fi && exec node dist/main.js"]
