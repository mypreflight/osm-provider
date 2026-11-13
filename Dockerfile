FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS alpine-node-base
RUN apk --no-cache add curl
RUN npm install -g npm@12 && npm cache clean --force

FROM alpine-node-base AS development
WORKDIR /app
COPY --chown=node:node . .
ENTRYPOINT ["/app/docker/dev/entrypoint"]

FROM alpine-node-base AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run bundle

FROM scratch AS export
COPY --from=build /app/dist/lambda.js ./
