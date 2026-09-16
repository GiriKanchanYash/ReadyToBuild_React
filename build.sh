#!/usr/bin/env bash
set -e

echo "==> Building React frontend..."
cd frontend
npm ci
npm run build
cd ..

echo "==> Copying dist to backend/static..."
rm -rf backend/static
cp -r frontend/dist backend/static

echo "==> Build complete. Deploy the 'backend/' folder to Azure App Service."
