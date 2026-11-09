#!/bin/sh

set -e

rm -f dist.zip
rm -rf lambda-out

docker build --no-cache --target export --output type=local,dest=./lambda-out .

cd lambda-out
find . -exec touch -h -t 198001010000 {} +
zip -X -r ../dist.zip .
cd ..

rm -rf lambda-out
echo "✅ dist.zip ready"
