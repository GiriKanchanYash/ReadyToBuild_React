# syntax=docker/dockerfile:1
 
# ---------- Stage 1: build the React (Vite) frontend ----------
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output lands in /frontend/dist
 
# ---------- Stage 2: FastAPI backend runtime ----------
FROM python:3.11-slim
 
# ODBC Driver 18 for SQL Server + unixODBC (required by pyodbc for the
# Fabric SQL endpoint connection). Baked into the image once here, so no
# apt-get needs to run at container startup.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl gnupg apt-transport-https unixodbc unixodbc-dev \
&& curl -sSL https://packages.microsoft.com/keys/microsoft.asc | apt-key add - \
&& curl -sSL https://packages.microsoft.com/config/debian/12/prod.list \
> /etc/apt/sources.list.d/mssql-release.list \
&& apt-get update \
&& ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
&& apt-get clean && rm -rf /var/lib/apt/lists/*
 
WORKDIR /app
 
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
 
# app/ and fabric_app/ must stay siblings inside /app -- app/service_factory.py
# adds "../fabric_app" to sys.path at runtime to import fabric_app's modules.
COPY backend/app ./app
COPY backend/fabric_app ./fabric_app
 
# Built frontend becomes the static files FastAPI serves.
COPY --from=frontend-build /frontend/dist ./static
 
EXPOSE 8000
ENV WEB_CONCURRENCY=2
 
# Azure Web App for Containers routes to whatever port WEBSITES_PORT is set
# to in App Settings -- set that to 8000 to match this.
CMD ["python", "-m", "gunicorn", "app.main:app", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--timeout", "120", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]