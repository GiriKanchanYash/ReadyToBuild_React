# ClearToBuild — React + FastAPI

Full-stack replacement for the Snowflake Streamlit app.

## Architecture

```
react_app/
├── frontend/          # React + Vite + TypeScript
│   ├── src/
│   │   ├── api/       # API client (ctbApi.ts)
│   │   ├── components/# Reusable UI components
│   │   ├── pages/     # Dashboard, WO ATP, BOM Explorer, Shortage Agent
│   │   └── types/     # TypeScript interfaces
│   └── package.json
└── backend/           # FastAPI + Snowflake
    ├── app/
    │   ├── main.py    # FastAPI app entry point
    │   ├── db.py      # Snowflake connection helper
    │   ├── routers/   # API route definitions
    │   └── services/  # Snowflake query logic
    ├── requirements.txt
    └── .env.example
```

## Quick Start

### 1. Backend (FastAPI)

```bash
cd react_app

# Create virtualenv
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate  # macOS/Linux


cd backend
# Install deps
pip install -r requirements.txt

# Configure Snowflake credentials
copy .env.example .env
# Edit .env with your Snowflake account details

# Run the API server
uvicorn app.main:app --reload
```

The API will be at `http://localhost:8000`. Docs at `http://localhost:8000/docs`.

### 2. Frontend (React)
### download node.js at https://nodejs.org
### open new terminal and check node -v and npm -v
```bash
cd react_app
venv\Scripts\activate
cd frontend

npm install
npm run dev
```

The app will be at `http://localhost:5173`. API calls are proxied to `localhost:8000`.

## API Endpoints

| Method | Path                              | Description                |
|--------|-----------------------------------|----------------------------|
| GET    | /api/ctb/filters                  | Product/Plant/Week options |
| GET    | /api/ctb/kpis                     | KPI summary tiles          |
| GET    | /api/ctb/status-distribution      | CTB donut chart data       |
| GET    | /api/ctb/top-shortages            | Top shortage parts         |
| GET    | /api/ctb/by-priority              | CTB by priority stacked    |
| GET    | /api/ctb/work-orders              | Work order list            |
| GET    | /api/ctb/work-orders/{id}         | WO detail + BOM parts      |
| GET    | /api/ctb/bom/{product_id}         | Full BOM explosion         |
| GET    | /api/ctb/shortage-alerts          | Open shortage alerts       |
| GET    | /api/ctb/supplier-performance     | Supplier on-time rates     |
| POST   | /api/ctb/refresh                  | Refresh dynamic tables     |
| POST   | /api/ctb/work-orders/{id}/prioritize | Prioritize a WO         |
| POST   | /api/ctb/create-po                | Create a purchase order    |

All GET endpoints accept optional `?product=&plant=&week=` query params.

## Pages

1. **Dashboard** — KPI tiles, CTB donut, top shortages bar chart, priority breakdown, work order table
2. **WO ATP** — Search a work order, see header + BOM part-level availability status
3. **BOM Explorer** — Enter a product ID, see full multi-level BOM explosion
4. **Shortage Agent** — Shortage alerts table, shortage-by-part chart, supplier performance
