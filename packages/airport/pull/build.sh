#!/bin/sh
set -eu

cd "$(dirname "$0")"

rm -rf lib
npm ci --omit=dev --no-audit --no-fund --silent
npx tsc -p tsconfig.json
