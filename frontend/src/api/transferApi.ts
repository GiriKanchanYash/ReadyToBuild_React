import type {
  PlantGeo,
  Lane,
  ShortagePart,
  TransferCandidatesResponse,
  OpenStoRow,
} from '../types/transfer';
import { getDataSource } from './dataSource';

const BASE = '/api/transfer';
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

async function toApiError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { detail?: unknown };
    detail = typeof body?.detail === 'string' ? body.detail : '';
  } catch {
    /* ignore */
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

export const transferApi = {
  plants: () => get<PlantGeo[]>(`${BASE}/plants`),

  lanes: (filter: { origin?: string; dest?: string } = {}) =>
    get<Lane[]>(`${BASE}/lanes${qs(filter)}`),

  shortageParts: (dest_plant?: string, limit = 50) =>
    get<ShortagePart[]>(`${BASE}/shortage-parts${qs({ dest_plant, limit })}`),

  candidates: (params: {
    part_number: string;
    dest_plant: string;
    weight_impact?: number;
    weight_speed?: number;
    weight_cost?: number;
  }) => get<TransferCandidatesResponse>(`${BASE}/candidates${qs(params)}`),

  openStos: (dest_plant?: string) =>
    get<OpenStoRow[]>(`${BASE}/open-stos${qs({ dest_plant })}`),

  createSto: (body: {
    part_number: string;
    qty: number;
    origin_plant_id: string;
    dest_plant_id: string;
    transport_mode: string;
    requested_delivery_date: string;
  }) => post<Record<string, unknown>>(`${BASE}/create-sto`, body),

  refresh: () => post<Record<string, unknown>>(`${BASE}/refresh`),
};
