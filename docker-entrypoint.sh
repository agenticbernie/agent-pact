#!/bin/sh
set -e

# Start the Express backend in the background.
cd /app/backend
npx tsx src/server.ts &

# Start nginx in the foreground.
exec nginx -g 'daemon off;'
