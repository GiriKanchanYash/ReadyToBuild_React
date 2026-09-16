import { getDataSource } from './dataSource';

const BASE = '/api/ctb';
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
// (snowflake|fabric) so the backend's service_factory can route it -
// callers of ctbApi.* don't need to pass this themselves. Applied here
// (not in qs()) so it covers every request, including the ones that build
// their URL without qs() (e.g. workOrderDetail, prioritizationSim, refresh).
function withDataSource(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}data_source=${encodeURIComponent(getDataSource())}`;
}

async function toApiError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json() as { detail?: unknown };
    detail = typeof body?.detail === 'string' ? body.detail : '';
  } catch {
    // ignore non-JSON errors
  }
  const base = `API ${res.status}: ${res.statusText}`;
  return new Error(detail ? `${base} - ${detail}` : base);
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(withDataSource(url), { headers: authHeaders() });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(withDataSource(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

type F = { product?: string; plant?: string; week?: string };

// In-memory GET cache so page navigation doesn't re-fetch heavy filter lists.
// Cache key is full URL (including query params).
const _getCache = new Map<string, { expiresAt: number; value: unknown }>();
const _inflight = new Map<string, Promise<unknown>>();

function _now() {
  return Date.now();
}

async function cachedGet<T>(url: string, ttlMs: number): Promise<T> {
  const cached = _getCache.get(url);
  if (cached && cached.expiresAt > _now()) return cached.value as T;

  const inflight = _inflight.get(url);
  if (inflight) return (await inflight) as T;

  const p = (async () => {
    const value = await get<T>(url);
    _getCache.set(url, { expiresAt: _now() + ttlMs, value });
    return value;
  })();

  _inflight.set(url, p);
  try {
    return (await p) as T;
  } finally {
    _inflight.delete(url);
  }
}

function clearCtbGetCache() {
  _getCache.clear();
}

export const ctbApi = {
  // Versioned key to invalidate older cached shape (plants as string[]).
  filters: () => cachedGet<import('../types/ctb').FilterOptions>(`${BASE}/filters?v=2`, 10 * 60 * 1000),

  kpis: (f: F = {}) =>
    cachedGet<import('../types/ctb').KpiData>(`${BASE}/kpis${qs(f)}`, 2 * 60 * 1000),

  statusDistribution: (f: F = {}) =>
    cachedGet<import('../types/ctb').StatusDistribution[]>(
      `${BASE}/status-distribution${qs(f)}`,
      2 * 60 * 1000,
    ),

  topShortages: (f: F = {}, limit = 10) =>
    cachedGet<import('../types/ctb').TopShortage[]>(
      `${BASE}/top-shortages${qs({ ...f, limit })}`,
      2 * 60 * 1000,
    ),

  byPriority: (f: F = {}) =>
    cachedGet<import('../types/ctb').PriorityBreakdown[]>(
      `${BASE}/by-priority${qs(f)}`,
      2 * 60 * 1000,
    ),

  workOrders: (f: F = {}) =>
    cachedGet<import('../types/ctb').WorkOrder[]>(`${BASE}/work-orders${qs(f)}`, 2 * 60 * 1000),

  workOrderDetail: (id: string) =>
    cachedGet<import('../types/ctb').WorkOrderDetail>(`${BASE}/work-orders/${id}`, 60 * 1000),

  // Always fetch fresh simulation so modal reflects latest board state.
  prioritizationSim: (woId: string) =>
    get<import('../types/ctb').PrioritizationSimRow[]>(
      `${BASE}/work-orders/${woId}/prioritization-sim`,
    ),

  prioritizationImpact: (woId: string) =>
    get<import('../types/ctb').PrioritizationImpactRow[]>(
      `${BASE}/work-orders/${woId}/prioritization-impact`,
    ),

  bom: (productId: string) =>
    cachedGet<import('../types/ctb').BomNode[]>(`${BASE}/bom/${productId}`, 2 * 60 * 1000),

  bomStats: (productId: string, woId?: string) =>
    cachedGet<import('../types/ctb').BomStats>(
      `${BASE}/bom-stats/${encodeURIComponent(productId)}${woId ? qs({ wo: woId }) : ''}`,
      2 * 60 * 1000,
    ),

  bomLineage: (productId: string, woId?: string) =>
    cachedGet<import('../types/ctb').BomLineageRow[]>(
      `${BASE}/bom-lineage/${encodeURIComponent(productId)}${woId ? qs({ wo: woId }) : ''}`,
      2 * 60 * 1000,
    ),

  bomWhereUsed: (constraintPart: string) =>
    cachedGet<import('../types/ctb').BomWhereUsedRow[]>(
      `${BASE}/bom-where-used/${constraintPart}`,
      2 * 60 * 1000,
    ),

  bomOpenPos: (constraintPart: string) =>
    cachedGet<import('../types/ctb').BomOpenPoRow[]>(
      `${BASE}/bom-open-pos/${constraintPart}`,
      2 * 60 * 1000,
    ),

  shortageAlerts: (f: F = {}) =>
    cachedGet<import('../types/ctb').ShortageAlert[]>(`${BASE}/shortage-alerts${qs(f)}`, 2 * 60 * 1000),

  supplierPerformance: () =>
    cachedGet<Record<string, unknown>[]>(`${BASE}/supplier-performance`, 10 * 60 * 1000),

  refresh: async () => {
    const r = await post<Record<string, unknown>>(`${BASE}/refresh`);
    clearCtbGetCache();
    return r;
  },

  prioritize: (woId: string) =>
    post<Record<string, unknown>>(`${BASE}/work-orders/${woId}/prioritize`),

  createPo: (body: {
    part_number: string;
    qty: number;
    supplier_id: string;
    plant_id: string;
    delivery_date: string;
  }) => post<Record<string, unknown>>(`${BASE}/create-po`, body),

  productionBoard: (f: Pick<F, 'product' | 'plant'> = {}) =>
    cachedGet<import('../types/ctb').ProductionBoardItem[]>(
      `${BASE}/production-board${qs(f)}`,
      2 * 60 * 1000,
    ),

  bomConstraints: (f: F = {}) =>
    cachedGet<import('../types/ctb').BomConstraint[]>(
      `${BASE}/bom-constraints${qs(f)}`,
      2 * 60 * 1000,
    ),

  // No client cache: grid must reflect latest inventory after filters/refresh.
  partsInventory: (params: {
    product?: string;
    plant?: string;
    week?: string;
    include_deliveries?: boolean;
    search?: string;
    limit?: number;
  } = {}) =>
    get<import('../types/ctb').PartInventoryRow[]>(
      `${BASE}/parts-inventory${qs({
        product: params.product,
        plant: params.plant,
        week: params.week,
        include_deliveries: params.include_deliveries ? 1 : 0,
        search: params.search,
        limit: params.limit ?? 50,
      })}`,
    ),
};
