"""
Fabric equivalent of the *orchestration* half of
backend/app/services/ai_service.py (the Snowflake version).

`ai_service.py` in this fabric_app package already provides the low-level
Azure OpenAI plumbing (generate_sql, cortex_complete, schema-prompt loading).
That's the Cortex Analyst / Cortex Complete replacement. What it does NOT yet
have is the higher-level "Copilot" behavior the frontend actually calls:
chat, quick analyses, saved insights, question history, and the Shortage
Agent actions. This file adds that layer, calling into `ai_service.py` for
the AI parts and `service.py` for the data parts, and returns dicts shaped
to match `frontend/src/api/aiApi.ts` exactly (CopilotChatResponse,
QuickAnalysisResult, SavedInsight, FrequentQuestion, ShortageQueueItem, etc.)

IMPORTANT - tables this file assumes exist in the Warehouse:
  - {Config.SAVED_INSIGHTS_TABLE}       (INSIGHT_ID, TITLE, QUESTION, SQL_TEXT,
                                          CREATED_BY, CREATED_AT)
  - {Config.GENIE_HISTORY_TABLE}        (QUESTION, TYPE, USER, CREATED_AT)
None of these are created by this Python file - they are database objects
that must exist in the Fabric Warehouse (same requirement Snowflake's
version has for SAVED_INSIGHTS / GENIE_QUESTION_HISTORY).
"""

from __future__ import annotations

import logging
from typing import Optional

from config import Config
import ai_service
import service
from db import run_warehouse_df, run_warehouse_non_query

logger = logging.getLogger(__name__)

SAVED_INSIGHTS_TABLE = Config.SAVED_INSIGHTS_TABLE
HISTORY_TABLE = Config.GENIE_HISTORY_TABLE


def _sql_escape(value) -> str:
    if value is None:
        return ""
    return str(value).replace("'", "''")


# ---------------------------------------------------------------------------
# Quick analyses (fixed, hardcoded SQL - same pattern as Snowflake's
# `copilot_quick_analyses` / `run_quick_analysis`, adapted to this schema)
# ---------------------------------------------------------------------------

_QUICK_ANALYSES = {
    "ctb_readiness": {
        "title": "CTB Readiness",
        "desc": "Ready vs partial vs blocked work orders right now.",
        "sql": f"""
            SELECT ctb.CTB_STATUS AS "status", COUNT(*) AS "count"
            FROM {service.DB}.{service.SCHEMA}.ctb_result_dt ctb
            JOIN {service.DB}.{service.SCHEMA}.work_order_dt wo
              ON ctb.WORK_ORDER_ID = wo.WORK_ORDER_ID
            WHERE wo.WORK_ORDER_STATUS NOT IN ('COMPLETED','CANCELLED','CLOSED')
            GROUP BY ctb.CTB_STATUS
            ORDER BY COUNT(*) DESC
        """,
    },
    "part_shortages": {
        "title": "Top Part Shortages",
        "desc": "Parts with the largest shortage quantity across open work orders.",
        "sql": f"""
            SELECT TOP (10)
                   p.DEMAND_PART_NUMBER AS "part_number",
                   SUM(p.SHORTAGE_QTY) AS "shortage_qty",
                   COUNT(DISTINCT p.WORK_ORDER_ID) AS "affected_orders"
            FROM {service.DB}.{service.SCHEMA}.pegging_dt p
            JOIN {service.DB}.{service.SCHEMA}.work_order_dt wo
              ON p.WORK_ORDER_ID = wo.WORK_ORDER_ID
            WHERE p.SHORTAGE_QTY > 0
              AND wo.WORK_ORDER_STATUS NOT IN ('COMPLETED','CANCELLED','CLOSED')
            GROUP BY p.DEMAND_PART_NUMBER
            ORDER BY SUM(p.SHORTAGE_QTY) DESC
        """,
    },
    "supplier_performance": {
        "title": "Supplier On-Time Performance",
        "desc": "Suppliers ranked by worst on-time delivery percentage.",
        "sql": f"""
            SELECT TOP (20)
                   SUPPLIER_ID,
                   COUNT(*) AS "total_orders",
                   SUM(CASE WHEN IS_LATE = 1 THEN 1 ELSE 0 END) AS "late_orders",
                   ROUND(100.0 * SUM(CASE WHEN IS_LATE = 0 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS "on_time_pct"
            FROM {service.DB}.{service.SCHEMA}.procurement_summary_dt
            GROUP BY SUPPLIER_ID
            ORDER BY "on_time_pct" ASC
        """,
    },
    "bom_completeness": {
        "title": "BOM Completeness",
        "desc": "Active BOM line counts per parent product.",
        "sql": f"""
            SELECT TOP (20)
                   PARENT_PART_NUMBER AS "product",
                   COUNT(*) AS "bom_line_count"
            FROM {service.DB}.{service.SCHEMA}.bom_dt
            WHERE BOM_STATUS = 'ACTIVE'
            GROUP BY PARENT_PART_NUMBER
            ORDER BY COUNT(*) DESC
        """,
    },
}


def copilot_quick_analyses() -> list[dict]:
    return [
        {"key": key, "title": v["title"], "desc": v["desc"], "question": v["desc"]}
        for key, v in _QUICK_ANALYSES.items()
    ]


def run_quick_analysis(key: str, user: str | None = None) -> dict:
    definition = _QUICK_ANALYSES.get(key)
    if not definition:
        return {"key": key, "metrics": {}, "rows": [], "sql": "", "descriptive": "",
                "prescriptive": "", "error": f"Unknown analysis key: {key}"}
    if user:
        save_question_history(definition["desc"], user, qtype=key)
    try:
        rows = service.run_query(definition["sql"])
        descriptive = f"{len(rows)} rows returned for {definition['title']}."
        prescriptive = ai_service.cortex_complete(
            f"Give a 2-3 sentence prescriptive recommendation for a manufacturing "
            f"planner based on this {definition['title']} data:\n{rows[:20]}"
        )
        return {
            "key": key,
            "metrics": {"row_count": len(rows)},
            "rows": rows,
            "sql": definition["sql"].strip(),
            "descriptive": descriptive,
            "prescriptive": prescriptive,
        }
    except Exception as exc:
        logger.exception("run_quick_analysis failed for key=%s", key)
        return {"key": key, "metrics": {}, "rows": [], "sql": definition["sql"].strip(),
                "descriptive": "", "prescriptive": "", "error": str(exc)}


# ---------------------------------------------------------------------------
# Free-form chat (Azure OpenAI text-to-SQL, replacing Cortex Analyst + Cortex
# Complete)
# ---------------------------------------------------------------------------

def copilot_chat(
    message: str,
    short_memory: Optional[str] = None,
    long_memory: Optional[str] = None,
    user: Optional[str] = None,
) -> dict:
    """
    Mirrors Snowflake ai_service.copilot_chat: generate SQL for the question,
    run it, then generate prescriptive bullets from the results.

    NOTE: unlike Cortex Analyst, `ai_service.generate_sql` here has no
    semantic-model-enforced guardrail beyond the system prompt itself - see
    the "no allowlist check" caveat already raised for the Snowflake AI
    Copilot; the same caveat applies here; consider adding a
    "does the statement start with SELECT/WITH" guard before execution in
    both places.
    """
    if user:
        save_question_history(message, user, qtype="custom")

    try:
        sql = ai_service.generate_sql(message)
    except Exception as exc:
        logger.exception("SQL generation failed")
        return {"response": f"I couldn't generate a query for that: {exc}"}

    sql_upper = sql.lstrip(";").strip().upper()
    if not (sql_upper.startswith("SELECT") or sql_upper.startswith("WITH")):
        return {"response": sql}

    try:
        rows = service.run_query(sql)
    except Exception as exc:
        logger.exception("Generated SQL failed to execute: %s", sql)
        return {"response": f"That query didn't run successfully: {exc}"}

    if not rows:
        return {"response": "No matching data was found for that question."}

    descriptive = f"{len(rows)} rows returned."
    context_note = ""
    if short_memory:
        context_note += f"\nRecent conversation: {short_memory}"
    if long_memory:
        context_note += f"\nKnown user context: {long_memory}"

    prescriptive = ai_service.cortex_complete(
        f"Question: {message}{context_note}\n\n"
        f"Give a short prescriptive recommendation (2-4 sentences) for a "
        f"manufacturing supply-chain planner based on this data:\n{rows[:20]}"
    )

    return {
        "key": "chat",
        "metrics": {"row_count": len(rows)},
        "rows": rows,
        "sql": sql,
        "descriptive": descriptive,
        "prescriptive": prescriptive,
    }


# ---------------------------------------------------------------------------
# Saved insights / question history
#
# NOTE: like the Snowflake version, `user` here should be the actual
# logged-in app user (threaded in from the JWT), NOT a shared service
# identity - see the "shared user" bug flagged for the Snowflake AI
# Copilot. Callers (routers/ai.py) must pass the real username through.
# ---------------------------------------------------------------------------

def save_question_history(question: str, user: str, qtype: str = "custom") -> None:
    try:
        run_warehouse_non_query(f"""
            INSERT INTO {HISTORY_TABLE} (QUESTION, [TYPE], [USER], CREATED_AT)
            VALUES ('{_sql_escape(question)}', '{_sql_escape(qtype)}', '{_sql_escape(user)}', GETDATE())
        """)
    except Exception:
        logger.debug("save_question_history failed", exc_info=True)


def load_saved_insights(user: str) -> list[dict]:
    try:
        df = run_warehouse_df(f"""
            SELECT INSIGHT_ID, TITLE, QUESTION, SQL_TEXT
            FROM {SAVED_INSIGHTS_TABLE}
            WHERE CREATED_BY = '{_sql_escape(user)}'
            ORDER BY CREATED_AT DESC
        """)
        return service._to_records(df)
    except Exception:
        logger.debug("load_saved_insights failed", exc_info=True)
        return []


def save_insight(title: str, question: str, user: str, sql_text: str = "") -> None:
    try:
        run_warehouse_non_query(f"""
            INSERT INTO {SAVED_INSIGHTS_TABLE} (TITLE, QUESTION, SQL_TEXT, CREATED_BY, CREATED_AT)
            VALUES ('{_sql_escape(title)}', '{_sql_escape(question)}', '{_sql_escape(sql_text)}',
                    '{_sql_escape(user)}', GETDATE())
        """)
    except Exception:
        logger.debug("save_insight failed", exc_info=True)


def delete_insight(insight_id: int, user: str) -> None:
    try:
        run_warehouse_non_query(f"""
            DELETE FROM {SAVED_INSIGHTS_TABLE}
            WHERE INSIGHT_ID = {int(insight_id)} AND CREATED_BY = '{_sql_escape(user)}'
        """)
    except Exception:
        logger.debug("delete_insight failed", exc_info=True)


def load_frequent_questions(user: str) -> list[dict]:
    try:
        df = run_warehouse_df(f"""
            SELECT TOP (10) QUESTION AS NORMALIZED_QUERY, [TYPE], COUNT(*) AS FREQUENCY
            FROM {HISTORY_TABLE}
            WHERE [USER] = '{_sql_escape(user)}'
            GROUP BY QUESTION, [TYPE]
            ORDER BY COUNT(*) DESC
        """)
        return service._to_records(df)
    except Exception:
        logger.debug("load_frequent_questions failed", exc_info=True)
        return []


def load_most_frequent_all() -> list[dict]:
    try:
        df = run_warehouse_df(f"""
            SELECT TOP (10) QUESTION AS NORMALIZED_QUERY, [TYPE], COUNT(*) AS TOTAL_FREQ
            FROM {HISTORY_TABLE}
            GROUP BY QUESTION, [TYPE]
            ORDER BY COUNT(*) DESC
        """)
        return service._to_records(df)
    except Exception:
        logger.debug("load_most_frequent_all failed", exc_info=True)
        return []


# ---------------------------------------------------------------------------
# Shortage Agent
# ---------------------------------------------------------------------------

def shortage_agent_queue() -> list[dict]:
    """Open shortages, ranked as ACT_NOW / PLAN_THIS_WEEK / MONITOR.

    Fabric/T-SQL STRING_AGG does not support the Snowflake-style DISTINCT
    argument, so distinct products/plants are pre-aggregated in CTEs.
    """
    return service.run_query(f"""
        WITH base AS (
            SELECT
                sa.PART_NUMBER,
                sa.WORK_ORDER_ID,
                sa.PLANT_ID,
                sa.SHORTAGE_QTY,
                wo.PRODUCT_ID,
                wo.PRIORITY,
                wo.PLANNED_START_DATE
            FROM {service.DB}.{service.SCHEMA}.shortage_alert_dt sa
            JOIN {service.DB}.{service.SCHEMA}.work_order_dt wo
              ON sa.WORK_ORDER_ID = wo.WORK_ORDER_ID
            WHERE sa.ALERT_STATUS = 'OPEN'
        ),
        agg AS (
            SELECT
                PART_NUMBER,
                COUNT(DISTINCT WORK_ORDER_ID) AS affected_wo_count,
                SUM(SHORTAGE_QTY) AS shortage_qty,
                MIN(PRIORITY) AS highest_priority,
                MIN(PLANNED_START_DATE) AS shortage_date_raw
            FROM base
            GROUP BY PART_NUMBER
        ),
        products AS (
            SELECT
                PART_NUMBER,
                STRING_AGG(PRODUCT_ID, ', ') WITHIN GROUP (ORDER BY PRODUCT_ID) AS affected_products
            FROM (SELECT DISTINCT PART_NUMBER, PRODUCT_ID FROM base) d
            GROUP BY PART_NUMBER
        ),
        plants AS (
            SELECT
                PART_NUMBER,
                STRING_AGG(PLANT_ID, ', ') WITHIN GROUP (ORDER BY PLANT_ID) AS affected_plants
            FROM (SELECT DISTINCT PART_NUMBER, PLANT_ID FROM base) d
            GROUP BY PART_NUMBER
        )
        SELECT
            a.PART_NUMBER AS "part_number",
            'CURRENT' AS "shortage_type",
            a.affected_wo_count AS "affected_wo_count",
            a.shortage_qty AS "shortage_qty",
            a.highest_priority AS "highest_priority",
            p.affected_products AS "affected_products",
            pl.affected_plants AS "affected_plants",
            CONVERT(varchar(10), a.shortage_date_raw, 120) AS "shortage_date",
            DATEDIFF(day, GETDATE(), a.shortage_date_raw) AS "days_until_shortage",
            0.0 AS "unit_cost",
            a.shortage_qty * 1.0 AS "business_impact_score",
            CASE
                WHEN a.highest_priority = 0 THEN 'ACT_NOW'
                WHEN DATEDIFF(day, GETDATE(), a.shortage_date_raw) <= 7 THEN 'PLAN_THIS_WEEK'
                ELSE 'MONITOR'
            END AS "action_group"
        FROM agg a
        LEFT JOIN products p ON p.PART_NUMBER = a.PART_NUMBER
        LEFT JOIN plants pl ON pl.PART_NUMBER = a.PART_NUMBER
        ORDER BY a.highest_priority, a.shortage_qty DESC
    """)


def shortage_agent_recommendation(payload: dict) -> dict:
    part_number = payload.get("part_number", "")
    rows = service.run_query(f"""
        SELECT TOP (5) SUPPLIER_ID, PART_NUMBER, UNIT_PRICE, LEAD_TIME_DAYS, MIN_ORDER_QTY
        FROM {service.DB}.{service.SCHEMA}.part_supplier_dt
        WHERE PART_NUMBER = '{_sql_escape(part_number)}'
        ORDER BY LEAD_TIME_DAYS ASC
    """)
    recommendation = ai_service.cortex_complete(
        f"A manufacturing planner needs to resolve a shortage of part "
        f"{part_number}. Available suppliers: {rows}. Give a short "
        f"(2-3 sentence) recommendation on which supplier to use and why."
    )
    return {"response": recommendation}


def shortage_agent_po_preview(payload: dict) -> list[dict]:
    part_number = payload.get("part_number", "")
    return service.run_query(f"""
        SELECT
            ps.SUPPLIER_ID AS "supplier_id",
            COALESCE(s.SUPPLIER_NAME, ps.SUPPLIER_ID) AS "supplier_name",
            ps.LEAD_TIME_DAYS AS "lead_time_days",
            ps.UNIT_PRICE AS "unit_price",
            ps.MIN_ORDER_QTY AS "min_order_qty",
            ps.MIN_ORDER_QTY AS "recommended_qty",
            '' AS "plant_id",
            CONVERT(varchar(10), DATEADD(day, ps.LEAD_TIME_DAYS, GETDATE()), 120) AS "delivery_date"
        FROM {service.DB}.{service.SCHEMA}.part_supplier_dt ps
        LEFT JOIN {service.DB}.{service.SCHEMA}.supplier_summary_dt s
          ON ps.SUPPLIER_ID = s.SUPPLIER_ID
        WHERE ps.PART_NUMBER = '{_sql_escape(part_number)}'
        ORDER BY ps.LEAD_TIME_DAYS ASC
    """)


def shortage_agent_create_po(payload: dict) -> dict:
    """Creates a real PO via the Warehouse stored procedure. See the
    IMPORTANT note on service.create_po - SP_CREATE_PO must exist in Fabric."""
    try:
        result = service.create_po(
            part_number=payload.get("part_number", ""),
            qty=int(payload.get("recommended_qty") or payload.get("shortage_qty") or 0),
            supplier_id=payload.get("supplier_id", ""),
            plant_id=payload.get("plant_id", ""),
            delivery_date=payload.get("delivery_date", ""),
        )
        po_id = result.get("PO_ID") or result.get("po_id")
        return {"ok": True, "message": "Purchase order created.", "po_id": po_id}
    except Exception as exc:
        logger.exception("shortage_agent_create_po failed")
        return {"ok": False, "message": str(exc)}


def shortage_agent_email_draft(payload: dict) -> dict:
    part_number = payload.get("part_number", "")
    supplier_name = payload.get("supplier_id", "the supplier")
    qty = payload.get("recommended_qty") or payload.get("shortage_qty") or 0
    body = ai_service.cortex_complete(
        f"Write a brief, professional email to a supplier ({supplier_name}) "
        f"requesting an expedited purchase order for {qty} units of part "
        f"{part_number} due to a production shortage. Keep it under 120 words."
    )
    return {
        "to": "",
        "subject": f"Urgent PO Request - Part {part_number}",
        "body": body,
    }


def shortage_agent_mark_resolved(payload: dict) -> dict:
    # CAUTION: SHORTAGE_ALERT_VW is a view (the _VW suffix follows this
    # project's naming convention for views). Views built from joins/
    # aggregations are usually not directly UPDATE-able in T-SQL unless the
    # Fabric Warehouse team has specifically made it updatable (e.g. a thin
    # 1:1 view over a single base table with INSTEAD OF triggers). If this
    # UPDATE fails, point it at the real underlying alert table instead.
    part_number = payload.get("part_number", "")
    try:
        run_warehouse_non_query(f"""
            UPDATE {service.DB}.{service.SCHEMA}.shortage_alert_dt
            SET ALERT_STATUS = 'RESOLVED'
            WHERE PART_NUMBER = '{_sql_escape(part_number)}' AND ALERT_STATUS = 'OPEN'
        """)
        return {"ok": True, "message": "Marked resolved."}
    except Exception as exc:
        logger.exception("shortage_agent_mark_resolved failed")
        return {"ok": False, "message": str(exc)}
