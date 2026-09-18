#!/bin/zsh
# Runs Finance Manager as a background service: build once, then serve the built
# page and its local API (sources, rate, money, assistant) on 127.0.0.1:5177.
# The built preview server does not watch files, so it uses less memory and CPU
# than `npm run dev`. After changing the code, restart the service to rebuild.
set -e
cd "${0:A:h}/.."
export PATH=/opt/homebrew/bin:/usr/bin:/bin
node_modules/.bin/vite build --logLevel warn
exec node_modules/.bin/vite preview
