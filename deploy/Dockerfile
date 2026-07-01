# Optional container path for deploying the gateway anywhere.
#
#   docker build -f deploy/Dockerfile -t llm-gateway .
#   docker run --rm -p 3333:3333 --env-file .env llm-gateway
#
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
EXPOSE 3333
CMD ["node", "dist/server.js"]
