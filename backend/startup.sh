#!/bin/bash
set -euo pipefail
cd /home/site/wwwroot

# Pre-built Linux wheels in the zip (SCM_DO_BUILD_DURING_DEPLOYMENT=false).
if [ -d "./.python_packages/lib/site-packages" ]; then
  export PYTHONPATH="./.python_packages/lib/site-packages${PYTHONPATH:+:$PYTHONPATH}"
fi

# Oryx antenv when remote build is enabled (slow; can hit 230s deploy timeout).
if [ -d "./antenv/bin" ]; then
  export PATH="./antenv/bin:${PATH}"
fi

PORT="${PORT:-8000}"
WORKERS="${WEB_CONCURRENCY:-2}"

exec python -m gunicorn app.main:app \
  --bind "0.0.0.0:${PORT}" \
  --workers "${WORKERS}" \
  --worker-class uvicorn.workers.UvicornWorker \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
