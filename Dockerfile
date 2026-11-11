FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216 AS alpine-node-base
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
