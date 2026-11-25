# Official node:24.22.3-bookworm-slim, linux/amd64; diverifikasi BOOT-01.
FROM node:24.22.3-bookworm-slim@sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e AS build

WORKDIR /app

RUN npm install --global npm@11.19.1 --ignore-scripts --no-audit --no-fund

COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.22.3-bookworm-slim@sha256:0e2646ab57e77b7a384a0cb59b6815b182c77e1f9c3ba36bd8435bd9c4e6680e AS runtime

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node contracts/v1/domain.schema.json contracts/v1/contract.schema.json ./contracts/v1/
COPY --chown=node:node configs/pricing ./configs/pricing/

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:' + process.env.PORT + '/health/live'); process.exit(r.ok ? 0 : 1)"]

CMD ["node", "dist/main.js"]
