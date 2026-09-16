import { getDataSource } from './dataSource';

const BASE = '/api/ai';
const TOKEN_KEY = 'rtb_auth_token';

function authHeaders(): HeadersInit {
  const token = window.localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// Every request automatically carries the currently-selected data source
// (snowflake|fabric) so the backend's service_factory can route it.
function withDataSource(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}data_source=${encodeURIComponent(getDataSource())}`;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(withDataSource(url), { headers: authHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(withDataSource(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// Shared in-memory GET cache (lightweight) to avoid repeated loads on navigation.
const _aiGetCache = new Map<string, { expiresAt: number; value: unknown }>();
const _aiInflight = new Map<string, Promise<unknown>>();
function _aiNow() {
  return Date.now();
}
async function cachedAiGet<T>(url: string, ttlMs: number): Promise<T> {
  const cached = _aiGetCache.get(url);
  if (cached && cached.expiresAt > _aiNow()) return cached.value as T;

  const inflight = _aiInflight.get(url);
  if (inflight) return (await inflight) as T;

  const p = (async () => {
    const value = await get<T>(url);
    _aiGetCache.set(url, { expiresAt: _aiNow() + ttlMs, value });
    return value;
  })();

  _aiInflight.set(url, p);
  try {
    return (await p) as T;
  } finally {
    _aiInflight.delete(url);
  }
}

export type QuickAnalysisDef = { key: string; title: string; desc: string; question: string };
export type ChartConfig = { type: string; xKey: string; yKey: string; color: string; title: string };
export type QuickAnalysisResult = { key: string; metrics: Record<string, unknown>; rows: Record<string, unknown>[]; sql: string; descriptive: string; prescriptive: string; chart?: ChartConfig; error?: string };
export type CopilotChatResponse =
  | { response: string }
  | {
      key: string;
      metrics: Record<string, unknown>;
      rows: Record<string, unknown>[];
      sql: string;
      descriptive: string;
      prescriptive: string;
      chart?: ChartConfig;
      error?: string;
    };

export type ShortageQueueItem = {
  part_number: string;
  shortage_type: 'CURRENT' | 'PREDICTED';
  affected_wo_count: number;
  shortage_qty: number;
  highest_priority: number;
  affected_products: string | null;
  affected_plants: string | null;
  shortage_date: string | null;
  days_until_shortage: number;
  unit_cost: number;
  business_impact_score: number;
  action_group: 'ACT_NOW' | 'PLAN_THIS_WEEK' | 'MONITOR';
};

export type RecommendResponse = { response: string };
export type CreatePoResponse = { ok: boolean; message: string; po_id?: string };
export type EmailDraftResponse = { to: string; subject: string; body: string };
export type MarkResolvedResponse = { ok: boolean; message: string };
export type PoPreviewItem = {
  supplier_id: string;
  supplier_name: string;
  lead_time_days: number;
  unit_price: number;
  min_order_qty: number;
  recommended_qty: number;
  plant_id: string;
  delivery_date: string;
};

export type SavedInsight = { INSIGHT_ID: number; TITLE: string; QUESTION: string; SQL_TEXT: string };
export type FrequentQuestion = { NORMALIZED_QUERY: string; TYPE: string; FREQUENCY: number };
export type MostFrequentQuestion = { NORMALIZED_QUERY: string; TYPE: string; TOTAL_FREQ: number };

export const aiApi = {
  quickAnalyses: () => get<QuickAnalysisDef[]>(`${BASE}/copilot/quick-analyses`),
  runAnalysis: (key: string) => post<QuickAnalysisResult>(`${BASE}/copilot/run-analysis`, { key }),
  chat: (
    message: string,
    ctx?: {
      short_memory?: string | null;
      long_memory?: string | null;
    },
  ) =>
    post<CopilotChatResponse>(`${BASE}/copilot/chat`, {
      message,
      short_memory: ctx?.short_memory ?? null,
      long_memory: ctx?.long_memory ?? null,
    }),

  savedInsights: () => get<SavedInsight[]>(`${BASE}/copilot/saved-insights`),
  saveInsight: (title: string, question: string, sql_text?: string) =>
    post<{ ok: boolean }>(`${BASE}/copilot/save-insight`, { title, question, sql_text: sql_text || '' }),
  deleteInsight: (insight_id: number) =>
    post<{ ok: boolean }>(`${BASE}/copilot/delete-insight`, { insight_id }),
  frequentQuestions: () => get<FrequentQuestion[]>(`${BASE}/copilot/frequent-questions`),
  mostFrequent: () => get<MostFrequentQuestion[]>(`${BASE}/copilot/most-frequent`),

  shortageQueue: () => cachedAiGet<ShortageQueueItem[]>(`${BASE}/shortage-agent/queue`, 2 * 60 * 1000),
  // Cache queue for short periods to make navigation snappier.
  // If you need real-time updates, we can reduce TTL or clear it on actions.
  // (Keeping it in the same object for minimal changes.)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  recommendShortage: (item: Partial<ShortageQueueItem> & { part_number: string }) =>
    post<RecommendResponse>(`${BASE}/shortage-agent/recommend`, item),
  createShortagePo: (item: Partial<ShortageQueueItem> & { part_number: string }) =>
    post<CreatePoResponse>(`${BASE}/shortage-agent/create-po`, item),
  shortagePoPreview: (item: Partial<ShortageQueueItem> & { part_number: string }) =>
    post<PoPreviewItem[]>(`${BASE}/shortage-agent/po-preview`, item),
  shortageEmailDraft: (item: Partial<ShortageQueueItem> & { part_number: string }) =>
    post<EmailDraftResponse>(`${BASE}/shortage-agent/email-draft`, item),
  markShortageResolved: (item: Partial<ShortageQueueItem> & { part_number: string }) =>
    post<MarkResolvedResponse>(`${BASE}/shortage-agent/mark-resolved`, item),
};

