FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm install
COPY server server
COPY web web
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache python3 ca-certificates
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm install --omit=dev
WORKDIR /app
COPY --from=build /app/server/dist /app/server/dist
COPY --from=build /app/server/connectors /app/server/connectors
COPY --from=build /app/web/dist /app/web/dist
ENV PORT=8787 WEB_DIST=/app/web/dist DATA_FILE=/tmp/homehub/state.json
EXPOSE 8787
CMD ["node","server/dist/index.js"]
