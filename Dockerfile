ARG NODE_IMAGE=node:24-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm audit --audit-level=high
COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run check && npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
RUN apk upgrade --no-cache && apk add --no-cache ffmpeg font-dejavu ca-certificates
RUN rm -r /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack && rm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 DATA_DIR=/data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src/server ./src/server
USER node
EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
