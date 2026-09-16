# ReadyToBuild — Microsoft Fabric integration

This package keeps the existing Snowflake implementation unchanged and routes Microsoft Fabric requests through `backend/fabric_app`. The React frontend is the same frontend used by Snowflake; the existing Data Source selector sends `data_source=snowflake|fabric` with API requests.

## Fabric connection

1. Install Microsoft ODBC Driver 18 for SQL Server.
2. Install Python dependencies from `backend/requirements.txt`.
3. Copy `backend/.env.example` to `backend/.env` and populate the Fabric and Azure values.
4. Keep `FABRIC_SQL_SERVER` as the SQL endpoint hostname for the Fabric Warehouse/Lakehouse.
5. The current local authentication path uses Microsoft Entra `InteractiveBrowserCredential`; the browser sign-in is cached in memory.
6. Start the backend from `backend/` with `uvicorn app.main:app --reload --port 8000`.
7. Start/build the existing React frontend normally.

## What was fixed

- Fixed the Fabric `parts-inventory` query's delivery alias so the `INC_QTY` expression references the CTE output consistently. This is the direct cause of the reported `Invalid column name 'delivery_qty'` error.
- Fixed Fabric Copilot shortage aggregation so it does not use `STRING_AGG(DISTINCT ...)`, which is not valid T-SQL; distinct products/plants are pre-aggregated before `STRING_AGG`.
- Added the missing `azure-identity` dependency because `fabric_app/db.py` imports `InteractiveBrowserCredential`.
- Corrected the Fabric AI fallback prompt to use T-SQL `TOP (N)` rather than `TOPN`.
- Added Fabric environment variables to `.env.example`.

## Snowflake protection

No Snowflake service implementation was modified. The Fabric backend remains under `backend/fabric_app`, while `backend/app/service_factory.py` only selects which implementation handles a request.

## Important database note

The Fabric package contains `fabric_warehouse_setup.sql`. The stored-procedure bodies in that file are templates where the original Snowflake procedure implementation was not available. Before using write operations such as Create PO/priority updates in production, those Fabric Warehouse procedures must exist and match your actual Warehouse tables.
