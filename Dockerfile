FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS alpine-node-base
RUN apk --no-cache add curl
RUN npm install -g npm@12 && npm cache clean --force

FROM alpine-node-base AS development
WORKDIR /app
COPY --chown=node:node . .
ENTRYPOINT ["/app/docker/dev/entrypoint"]
