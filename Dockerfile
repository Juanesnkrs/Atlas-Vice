# LeonidApp — imagen única (API Fastify + cliente compilado servido por la misma API).
# Build:  docker build --build-arg VITE_API_URL=https://tu-dominio.com -t leonidapp .
# Run:    docker run --env-file .env.production -p 3000:3000 leonidapp
#
# El servidor lee el cliente desde /app/dist (ver server/src/services/ssrLite.ts), por lo que
# no hace falta un segundo servicio web. MongoDB va aparte (MongoDB Atlas) y Cloudflare delante.

ARG NODE_VERSION=24

# ---- 1. Cliente (Vite) --------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS client
RUN npm install -g pnpm@12.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.html vite.config.ts tailwind.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
# VITE_API_URL se incrusta en el bundle: sin él la app solo funciona en modo Invitado.
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN pnpm build

# ---- 2. Servidor (TypeScript -> dist) -----------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS server
RUN npm install -g pnpm@12.21.0
WORKDIR /app/server
COPY server/package.json server/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY server/tsconfig.json ./
COPY server/src ./src
RUN pnpm build \
 && pnpm prune --prod

# ---- 3. Runtime ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=client /app/dist ./dist
COPY --from=server /app/server/dist ./server/dist
COPY --from=server /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
