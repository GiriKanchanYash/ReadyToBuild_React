#!/bin/bash
set -euo pipefail
 
# --- ODBC Driver 18 for SQL Server (required by pyodbc for Fabric) ---
# The container filesystem outside /home is reset on every cold start and
# every scale-out instance, so the driver has to be (re)installed here
# rather than once. This runs as root on every boot -- this is Microsoft's
# own guidance for pyodbc on native App Service Linux:
# https://learn.microsoft.com/troubleshoot/azure/general/connect-sql-database-source-code
if ! command -v odbcinst >/dev/null 2>&1 || ! odbcinst -q -d | grep -qi "ODBC Driver 18"; then
    echo "Installing ODBC Driver 18 for SQL Server..."
    apt-get update -qq
    apt-get install -y -qq curl gnupg apt-transport-https unixodbc unixodbc-dev > /dev/null
    curl -sSL https://packages.microsoft.com/keys/microsoft.asc | apt-key add - > /dev/null 2>&1
    curl -sSL https://packages.microsoft.com/config/debian/12/prod.list \
> /etc/apt/sources.list.d/mssql-release.list
    apt-get update -qq
    ACCEPT_EULA=Y apt-get install -y -qq msodbcsql18 > /dev/null
else
    echo "ODBC Driver 18 already present, skipping install."
fi
 
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