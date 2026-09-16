// Single source of truth for which backend (Snowflake or Fabric) the app
// talks to. Persisted so a page refresh doesn't silently reset it back to
// Snowflake mid-session. Read synchronously by every api/*.ts file's qs()
// helper (so it rides along on every request as ?data_source=...), and
// subscribed to by the header dropdown so the UI updates immediately when
// the user switches sources.

export type DataSource = 'snowflake' | 'fabric';

const STORAGE_KEY = 'rtb_data_source';
const DEFAULT_SOURCE: DataSource = 'snowflake';

let current: DataSource = ((): DataSource => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'fabric' ? 'fabric' : DEFAULT_SOURCE;
  } catch {
    return DEFAULT_SOURCE;
  }
})();

const listeners = new Set<(value: DataSource) => void>();

export function getDataSource(): DataSource {
  return current;
}

export function setDataSource(value: DataSource): void {
  current = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore storage failures (e.g. private browsing)
  }
  listeners.forEach((listener) => listener(current));
}

export function subscribeDataSource(listener: (value: DataSource) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
