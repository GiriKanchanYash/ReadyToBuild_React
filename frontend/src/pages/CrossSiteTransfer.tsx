import { useEffect, useMemo, useState } from 'react';
import { transferApi } from '../api/transferApi';
import type {
  PlantGeo,
  Lane,
  ShortagePart,
  TransferCandidatesResponse,
  TransferCandidate,
  OpenStoRow,
  TransportMode,
} from '../types/transfer';

const KPI_BG: Record<string, string> = {
  inventory: 'linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%)',
  demand: 'linear-gradient(135deg,#fef3c7 0%,#fde68a 100%)',
  coverage: 'linear-gradient(135deg,#dcfce7 0%,#bbf7d0 100%)',
  need: 'linear-gradient(135deg,#fee2e2 0%,#fecaca 100%)',
};

const MODE_COLORS: Record<TransportMode, string> = {
  TRUCK: '#2563eb',
  AIR: '#dc2626',
  OCEAN: '#0891b2',
  RAIL: '#7c3aed',
};

const MODE_LABEL: Record<TransportMode, string> = {
  TRUCK: 'TRUCK',
  AIR: 'AIR',
  OCEAN: 'OCEAN',
  RAIL: 'RAIL',
};

function formatDays(days: number | null | undefined) {
  if (days == null) return '—';
  if (days >= 1) return `${Math.round(days)}d`;
  return `${(days * 24).toFixed(0)}h`;
}

function formatCost(usd: number | null | undefined) {
  if (usd == null) return '$0';
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  return `$${Math.round(usd)}`;
}

function formatDateRel(date: string | null) {
  if (!date) return '—';
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'today';
  if (days === 0) return 'today';
  return `D+${days}`;
}

/** Project lat/lon (degrees) onto an SVG canvas using a simple equirectangular
 *  transform. The map is purely illustrative (matches the screenshot's vibe). */
function project(
  lat: number,
  lon: number,
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  svg: { width: number; height: number; padding: number },
) {
  const lonRange = bounds.maxLon - bounds.minLon || 1;
  const latRange = bounds.maxLat - bounds.minLat || 1;
  const x = svg.padding + ((lon - bounds.minLon) / lonRange) * (svg.width - svg.padding * 2);
  const y = svg.padding + ((bounds.maxLat - lat) / latRange) * (svg.height - svg.padding * 2);
  return { x, y };
}

interface Props {
  /** Optional default destination plant; if absent the user picks one. */
  defaultDestPlant?: string;
}

export default function CrossSiteTransfer({ defaultDestPlant }: Props) {
  type IntegrationEvent = {
    id: string;
    title: string;
    system: string;
    status: 'SUCCESS' | 'FAILED';
    referenceId: string;
    details: string;
    createdAt: string;
  };

  // ----- Filters / selection -----
  const [destPlant, setDestPlant] = useState<string>(defaultDestPlant || '');
  const [partNumber, setPartNumber] = useState<string>('');

  // ----- Prioritization weights (drive scoring) -----
  const [wImpact, setWImpact] = useState(0.5);
  const [wSpeed, setWSpeed] = useState(0.3);
  const [wCost, setWCost] = useState(0.2);

  // ----- Data -----
  const [plants, setPlants] = useState<PlantGeo[]>([]);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [shortageParts, setShortageParts] = useState<ShortagePart[]>([]);
  const [response, setResponse] = useState<TransferCandidatesResponse | null>(null);
  const [openStos, setOpenStos] = useState<OpenStoRow[]>([]);

  // ----- UI state -----
  const [loading, setLoading] = useState(true);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState<TransferCandidate | null>(null);
  const [transferQty, setTransferQty] = useState<number>(0);
  const [transferMode, setTransferMode] = useState<TransportMode>('TRUCK');
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferMockResult, setTransferMockResult] = useState<{
    status: 'SUCCESS';
    referenceId: string;
    message: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showStos, setShowStos] = useState(false);
  const [integrationEvents, setIntegrationEvents] = useState<IntegrationEvent[]>([]);

  // ----- Initial load: plants + lanes -----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [p, l] = await Promise.all([transferApi.plants(), transferApi.lanes()]);
        if (!alive) return;
        setPlants(p);
        setLanes(l);
        if (!destPlant && p.length) {
          setDestPlant(p[0].plant_id);
        }
        setError(null);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // We deliberately only run this once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Reload shortage parts when destination changes -----
  useEffect(() => {
    let alive = true;
    if (!destPlant) return;
    (async () => {
      try {
        const sp = await transferApi.shortageParts(destPlant);
        if (!alive) return;
        setShortageParts(sp);
        if (sp.length && (!partNumber || !sp.some((s) => s.part_number === partNumber))) {
          setPartNumber(sp[0].part_number);
        } else if (!sp.length) {
          setPartNumber('');
          setResponse(null);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destPlant]);

  // ----- Reload candidates when (part, dest, weights) change -----
  useEffect(() => {
    let alive = true;
    if (!partNumber || !destPlant) return;
    (async () => {
      try {
        setLoadingCandidates(true);
        const [r, s] = await Promise.all([
          transferApi.candidates({
            part_number: partNumber,
            dest_plant: destPlant,
            weight_impact: wImpact,
            weight_speed: wSpeed,
            weight_cost: wCost,
          }),
          transferApi.openStos(destPlant),
        ]);
        if (!alive) return;
        setResponse(r);
        setOpenStos(s);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        if (alive) setLoadingCandidates(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [partNumber, destPlant, wImpact, wSpeed, wCost]);

  // ----- Derive map data: plants + dotted candidate lines to destination -----
  // Bounds dynamically focus on the *destination + candidate origins* so the
  // map visibly zooms / re-frames whenever the user changes the part or
  // destination. Other plants are still drawn but as faded "Other" dots.
  const displayedCandidates = useMemo(
    () => [...(response?.candidates || [])].sort((a, b) => b.score - a.score),
    [response],
  );

  const mapData = useMemo(() => {
    const svg = { width: 720, height: 380, padding: 56 };
    if (!plants.length) return null;

    // Plants we want the map to focus on for this query.
    const focusIds = new Set<string>();
    if (destPlant) focusIds.add(destPlant);
    displayedCandidates.forEach((c) => focusIds.add(c.origin_plant_id));
    const focusPlants = plants.filter((p) => focusIds.has(p.plant_id));
    // Fallback to all plants when there are no candidates yet so the map still renders.
    const reference = focusPlants.length >= 2 ? focusPlants : plants;

    const lats = reference.map((p) => p.latitude);
    const lons = reference.map((p) => p.longitude);
    let minLat = Math.min(...lats);
    let maxLat = Math.max(...lats);
    let minLon = Math.min(...lons);
    let maxLon = Math.max(...lons);

    // Ensure we always have some viewport even when only one plant is in focus.
    if (maxLat - minLat < 6) {
      const c = (maxLat + minLat) / 2;
      minLat = c - 6;
      maxLat = c + 6;
    }
    if (maxLon - minLon < 12) {
      const c = (maxLon + minLon) / 2;
      minLon = c - 12;
      maxLon = c + 12;
    }
    const padLat = (maxLat - minLat) * 0.18;
    const padLon = (maxLon - minLon) * 0.12;
    const bounds = {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLon: minLon - padLon,
      maxLon: maxLon + padLon,
    };

    const positions = new Map<string, { x: number; y: number }>();
    plants.forEach((p) => {
      positions.set(p.plant_id, project(p.latitude, p.longitude, bounds, svg));
    });

    const destPos = destPlant ? positions.get(destPlant) : null;
    const candidateLines = displayedCandidates.map((c) => {
      const origin = positions.get(c.origin_plant_id);
      return origin && destPos
        ? {
            ...c,
            x1: origin.x,
            y1: origin.y,
            x2: destPos.x,
            y2: destPos.y,
            mid: { x: (origin.x + destPos.x) / 2, y: (origin.y + destPos.y) / 2 },
          }
        : null;
    });

    return {
      svg,
      bounds,
      positions,
      focusIds,
      candidateLines: candidateLines.filter(Boolean),
    };
  }, [plants, destPlant, displayedCandidates]);

  // Timestamp of the last successful candidate refresh — surfaced in the UI
  // so the user can see the data was actually re-pulled.
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  useEffect(() => {
    if (response) setRefreshedAt(new Date());
  }, [response]);

  // ----- KPI numbers -----
  const kpi = response?.kpi;

  // ----- Open transfer modal pre-fills with chosen candidate -----
  const openTransfer = (c: TransferCandidate) => {
    setTransferOpen(c);
    setTransferMode(c.transport_mode);
    setTransferQty(Math.min(c.protectable_qty || 0, response?.kpi.gap_qty || 0));
    setTransferMockResult(null);
  };

  const submitTransfer = async () => {
    if (!transferOpen || !response) return;
    setTransferSubmitting(true);
    // Mock-only flow: we intentionally do NOT call backend create/refresh.
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const now = new Date();
    const mockStoId = `STO-${now.getTime().toString().slice(-6)}`;
    setTransferMockResult({
      status: 'SUCCESS',
      referenceId: mockStoId,
      message: `Mock STO created for ${response.part_number}: ${Math.round(transferQty)} EA from ${transferOpen.origin_plant_id} to ${response.dest_plant_id} via ${transferMode}.`,
    });
    setTransferSubmitting(false);
  };

  // Normalize weights to sum-to-1 for display.
  const normWeights = useMemo(() => {
    const total = wImpact + wSpeed + wCost || 1;
    return {
      impact: wImpact / total,
      speed: wSpeed / total,
      cost: wCost / total,
    };
  }, [wImpact, wSpeed, wCost]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 40, textAlign: 'center' }}>
        Loading Cross-Site Inventory Transfer...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* HERO */}
      <div className="page-hero">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="page-hero-title">
              CROSS-SITE INVENTORY TRANSFER
              {response?.dest_plant_name ? <span style={{ color: '#475569' }}> — LANES TO {response.dest_plant_name.toUpperCase()}</span> : null}
            </div>
            <div className="page-hero-subtitle">
              {partNumber
                ? <>Part <strong>{partNumber}</strong> — {response?.part_description || ''}. Ranking considers <strong>impact</strong>, <strong>speed (ETA)</strong>, and <strong>cost</strong>.</>
                : <>Pick a destination plant + part with shortage to evaluate inter-plant transfer options.</>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select value={destPlant} onChange={(e) => setDestPlant(e.target.value)} style={{ minWidth: 220 }}>
              {plants.map((p) => (
                <option key={p.plant_id} value={p.plant_id}>{p.plant_id} — {p.plant_name}</option>
              ))}
            </select>
            <select value={partNumber} onChange={(e) => setPartNumber(e.target.value)} style={{ minWidth: 240 }} disabled={!shortageParts.length}>
              {shortageParts.length === 0 && <option value="">No shortages at this plant</option>}
              {shortageParts.map((s) => (
                <option key={s.part_number} value={s.part_number}>
                  {s.part_number} — gap {Math.round(s.gap_qty)} EA
                </option>
              ))}
            </select>
            <button type="button" className="secondary" onClick={() => setShowStos((v) => !v)}>
              {showStos ? 'Hide STOs' : `In-Transit STOs (${openStos.length})`}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c' }}>{error}</div>
      ) : null}

      {/* KPIs */}
      <div className="grid-4">
        <div className="kpi-card" style={{ background: KPI_BG.inventory }}>
          <div className="kpi-label">Total Inventory</div>
          <div className="kpi-value">{kpi ? kpi.total_inventory.toLocaleString() : 0}</div>
        </div>
        <div className="kpi-card" style={{ background: KPI_BG.demand }}>
          <div className="kpi-label">Total Demand</div>
          <div className="kpi-value">{kpi ? kpi.total_demand.toLocaleString() : 0}</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>Build + Aftermarket</div>
        </div>
        <div className="kpi-card" style={{ background: KPI_BG.coverage }}>
          <div className="kpi-label">Coverage</div>
          <div className="kpi-value">{kpi ? `${Math.round(kpi.coverage_pct)}%` : '0%'}</div>
        </div>
        <div className="kpi-card" style={{ background: KPI_BG.need }}>
          <div className="kpi-label">Earliest Need</div>
          <div className="kpi-value">{formatDateRel(kpi?.earliest_need_date || null)}</div>
        </div>
      </div>

      {/* Map + weights/candidates */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16 }}>
        {/* MAP */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Global Facilities Map</div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              Hover a lane for mode, ETA, and cost.
            </div>
          </div>
          {mapData ? (
            <FacilitiesMap
              svg={mapData.svg}
              positions={mapData.positions}
              plants={plants}
              destPlant={destPlant}
              focusIds={mapData.focusIds}
              candidateLines={mapData.candidateLines as Array<NonNullable<typeof mapData.candidateLines[number]>>}
              dimmed={loadingCandidates}
            />
          ) : null}
        </div>

        {/* CANDIDATES */}
        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Prioritization Weights</div>
          <WeightSlider label={`Build Impact (${Math.round(normWeights.impact * 100)}%)`} value={wImpact} onChange={setWImpact} accent="#2563eb" />
          <WeightSlider label={`Speed / ETA (${Math.round(normWeights.speed * 100)}%)`} value={wSpeed} onChange={setWSpeed} accent="#16a34a" />
          <WeightSlider label={`Cost (${Math.round(normWeights.cost * 100)}%)`} value={wCost} onChange={setWCost} accent="#f59e0b" />

          <div style={{ height: 1, background: '#e2e8f0', margin: '8px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
              Best Pull Candidates {response?.candidates.length ? `(${response.candidates.length})` : ''}
            </div>
            <div style={{ fontSize: 11, color: loadingCandidates ? '#2563eb' : '#94a3b8', fontWeight: 600 }}>
              {loadingCandidates
                ? 'Updating…'
                : refreshedAt
                  ? `Updated ${refreshedAt.toLocaleTimeString()}`
                  : ''}
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#475569' }}>Score = Impact x Speed + Cost. Higher is better.</div>

          <div
            // The key forces React to remount the list when the part / dest /
            // weights change so the cards visibly fade-in instead of swapping
            // silently in place.
            key={`${partNumber}|${destPlant}|${wImpact.toFixed(2)}|${wSpeed.toFixed(2)}|${wCost.toFixed(2)}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              maxHeight: 540,
              overflowY: 'auto',
              paddingRight: 4,
              animation: 'cstFadeIn 220ms ease-out',
              opacity: loadingCandidates ? 0.55 : 1,
              transition: 'opacity 180ms ease',
            }}
          >
            {loadingCandidates && !response ? (
              <div style={{ padding: 16, color: '#475569' }}>Loading candidates...</div>
            ) : response && response.candidates.length === 0 ? (
              <div style={{ padding: 16, color: '#475569' }}>
                No source plants currently have transferable inventory of this part with an active lane to {destPlant}.
              </div>
            ) : (
              response?.candidates.map((c) => (
                <CandidateCard key={c.origin_plant_id} c={c} onTransfer={() => openTransfer(c)} />
              ))
            )}
          </div>

          {/* Local keyframes so we don't need to touch global CSS. */}
          <style>{`@keyframes cstFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`}</style>
        </div>
      </div>

      {showStos ? <OpenStosTable rows={openStos} /> : null}

      {transferOpen && response ? (
        <TransferModal
          candidate={transferOpen}
          dest={response}
          qty={transferQty}
          mode={transferMode}
          onQty={setTransferQty}
          onMode={setTransferMode}
          submitting={transferSubmitting}
          mockResult={transferMockResult}
          onCancel={() => setTransferOpen(null)}
          onSubmit={submitTransfer}
        />
      ) : null}

      {toast ? (
        <div
          style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 200,
            background: '#0f172a', color: '#fff', padding: '12px 18px',
            borderRadius: 12, boxShadow: '0 12px 32px rgba(15,23,42,.30)',
            fontSize: 14, fontWeight: 500,
          }}
        >
          {toast}
        </div>
      ) : null}

      {integrationEvents.length > 0 ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
            Source System Activity
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {integrationEvents.map((event) => (
              <div
                key={event.id}
                style={{
                  border: `1px solid ${event.status === 'SUCCESS' ? '#86efac' : '#fecaca'}`,
                  background: event.status === 'SUCCESS' ? '#f0fdf4' : '#fef2f2',
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{event.title}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: event.status === 'SUCCESS' ? '#166534' : '#b91c1c' }}>
                    {event.status}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{event.system}</div>
                <div style={{ fontSize: 11, color: '#0f172a', marginTop: 2 }}>
                  Ref: <strong>{event.referenceId}</strong>
                </div>
                <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>{event.details}</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{event.createdAt}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Lane catalog (collapsed footer) */}
      <details className="card" style={{ padding: 14 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#0f172a' }}>
          Lane catalog ({lanes.length} active lanes)
        </summary>
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Origin</th>
                <th>Destination</th>
                <th>Mode</th>
                <th>Carrier</th>
                <th>Distance</th>
                <th>Transit</th>
                <th>$/Unit</th>
                <th>Reliability</th>
              </tr>
            </thead>
            <tbody>
              {lanes.slice(0, 200).map((l) => (
                <tr key={l.lane_id}>
                  <td style={{ padding: '8px 12px' }}>{l.origin_plant_id} — {l.origin_plant_name}</td>
                  <td style={{ padding: '8px 12px' }}>{l.dest_plant_id} — {l.dest_plant_name}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ background: MODE_COLORS[l.transport_mode] + '22', color: MODE_COLORS[l.transport_mode], padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{MODE_LABEL[l.transport_mode]}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{l.carrier_name}</td>
                  <td style={{ padding: '8px 12px' }}>{Math.round(l.distance_km).toLocaleString()} km</td>
                  <td style={{ padding: '8px 12px' }}>{formatDays(l.transit_days)}</td>
                  <td style={{ padding: '8px 12px' }}>${l.cost_per_unit_usd.toFixed(2)}</td>
                  <td style={{ padding: '8px 12px' }}>{l.reliability_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================

function WeightSlider({ label, value, onChange, accent }: {
  label: string; value: number; onChange: (v: number) => void; accent: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#334155', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span style={{ color: accent, fontWeight: 700 }}>{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: accent }}
      />
    </div>
  );
}

function CandidateCard({ c, onTransfer }: { c: TransferCandidate; onTransfer: () => void }) {
  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 14,
        padding: 12,
        background: '#fff',
        boxShadow: '0 4px 10px rgba(15,23,42,.04)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{c.origin_plant_name}</div>
        <div style={{ fontSize: 12, color: '#475569' }}>Score <span style={{ color: '#0f172a', fontWeight: 700 }}>{c.score.toFixed(1)}</span></div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Pill label={`Qty ${Math.round(c.protectable_qty)}`} bg="#dbeafe" fg="#1e40af" />
        <Pill label={`ETA ${formatDays(c.transit_days)}`} bg="#dcfce7" fg="#166534" />
        <Pill label={`Cost ${formatCost(c.cost_per_unit_usd * Math.round(c.protectable_qty || 0))}`} bg="#fef3c7" fg="#92400e" />
        <Pill label={c.transport_mode} bg={MODE_COLORS[c.transport_mode] + '22'} fg={MODE_COLORS[c.transport_mode]} />
        <button type="button" className="primary" style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12 }} onClick={onTransfer}>
          TRANSFER
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
        Protects {c.protected_builds || 0} build{(c.protected_builds || 0) === 1 ? '' : 's'} if shipped now.
        Source plant has {Math.round(c.origin_available_qty)} EA on hand (safety stock {Math.round(c.origin_safety_stock)}).
      </div>
    </div>
  );
}

function Pill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999 }}>
      {label}
    </span>
  );
}

function FacilitiesMap({
  svg,
  positions,
  plants,
  destPlant,
  focusIds,
  candidateLines,
  dimmed,
}: {
  svg: { width: number; height: number; padding: number };
  positions: Map<string, { x: number; y: number }>;
  plants: PlantGeo[];
  destPlant: string;
  focusIds: Set<string>;
  candidateLines: Array<{
    origin_plant_id: string;
    origin_plant_name: string;
    transport_mode: TransportMode;
    transit_days: number;
    cost_per_unit_usd: number;
    protectable_qty: number;
    score: number;
    x1: number; y1: number; x2: number; y2: number;
    mid: { x: number; y: number };
  }>;
  dimmed?: boolean;
}) {
  const [hoveredLane, setHoveredLane] = useState<string | null>(null);
  const [selectedLane, setSelectedLane] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [lastPointer, setLastPointer] = useState<{ x: number; y: number } | null>(null);
  const lineScoreStats = useMemo(() => {
    if (!candidateLines.length) return { min: 0, span: 1 };
    const scores = candidateLines.map((c) => c.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    return { min, span: Math.max(1, max - min) };
  }, [candidateLines]);
  const minZoom = 0.8;
  const maxZoom = 2.4;
  const zoomStep = 0.2;
  const centerX = svg.width / 2;
  const centerY = svg.height / 2;
  const clampPan = (next: { x: number; y: number }, z: number) => {
    const maxX = ((z - 1) * svg.width) / 2;
    const maxY = ((z - 1) * svg.height) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  };

  const applyZoom = (nextZoom: number) => {
    const z = Math.max(minZoom, Math.min(maxZoom, Number(nextZoom.toFixed(2))));
    setZoom(z);
    setPan((p) => clampPan(p, z));
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          right: 8,
          top: 8,
          zIndex: 5,
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          background: 'rgba(255,255,255,0.92)',
          border: '1px solid #e2e8f0',
          borderRadius: 10,
          padding: '6px 8px',
          boxShadow: '0 2px 8px rgba(15,23,42,.08)',
        }}
      >
        <button
          type="button"
          className="secondary"
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => applyZoom(zoom + zoomStep)}
        >
          Zoom In
        </button>
        <button
          type="button"
          className="secondary"
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => applyZoom(zoom - zoomStep)}
        >
          Zoom Out
        </button>
        <button
          type="button"
          className="secondary"
          style={{ padding: '4px 8px', fontSize: 12 }}
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
            setSelectedLane(null);
          }}
        >
          Reset
        </button>
      </div>

      <svg
        viewBox={`0 0 ${svg.width} ${svg.height}`}
        width="100%"
        height={svg.height}
        style={{
          background: 'radial-gradient(ellipse at center, #f8fafc 0%, #eef2f7 100%)',
          borderRadius: 12,
          opacity: dimmed ? 0.6 : 1,
          transition: 'opacity 180ms ease',
          cursor: isPanning ? 'grabbing' : zoom > 1 ? 'grab' : 'default',
          userSelect: 'none',
        }}
        onMouseDown={(e) => {
          if (zoom <= 1) return;
          setIsPanning(true);
          setLastPointer({ x: e.clientX, y: e.clientY });
        }}
        onMouseMove={(e) => {
          if (!isPanning || !lastPointer) return;
          const dx = e.clientX - lastPointer.x;
          const dy = e.clientY - lastPointer.y;
          setPan((p) => clampPan({ x: p.x + dx, y: p.y + dy }, zoom));
          setLastPointer({ x: e.clientX, y: e.clientY });
        }}
        onMouseUp={() => {
          setIsPanning(false);
          setLastPointer(null);
        }}
        onMouseLeave={() => {
          setIsPanning(false);
          setLastPointer(null);
        }}
      >
        <g transform={`translate(${pan.x} ${pan.y})`}>
          <g transform={`translate(${centerX} ${centerY}) scale(${zoom}) translate(${-centerX} ${-centerY})`}>
          {/* subtle grid */}
          <defs>
            <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x={0} y={0} width={svg.width} height={svg.height} fill="url(#grid-pattern)" />

          {/* candidate lanes (origin -> destination) */}
          {candidateLines.map((cl, idx) => {
            const c = MODE_COLORS[cl.transport_mode] || '#64748b';
            const laneKey = cl.origin_plant_id + '-line';
            const scoreNorm = (cl.score - lineScoreStats.min) / lineScoreStats.span;
            const strokeWidth = 1.4 + scoreNorm * 2.2;
            const opacity = 0.3 + scoreNorm * 0.65;
            const dx = cl.x2 - cl.x1;
            const dy = cl.y2 - cl.y1;
            const len = Math.hypot(dx, dy) || 1;
            const nx = -dy / len;
            const ny = dx / len;
            const bend = ((idx % 2 === 0 ? 1 : -1) * (8 + Math.floor(idx / 2) * 2));
            const cx = cl.mid.x + nx * bend;
            const cy = cl.mid.y + ny * bend;
            const isHovered = hoveredLane === laneKey;
            const isSelected = selectedLane === laneKey;
            const dimOthers = !!selectedLane && !isSelected;
            const laneInfo = `${cl.transport_mode} • ${formatDays(cl.transit_days)} • ${formatCost(cl.cost_per_unit_usd * Math.round(cl.protectable_qty || 0))}`;
            const boxWidth = Math.max(190, Math.min(280, cl.origin_plant_name.length * 6 + 36));
            const boxHeight = 40;
            const boxX = Math.max(8, Math.min(svg.width - boxWidth - 8, cx - boxWidth / 2));
            const boxY = Math.max(8, Math.min(svg.height - boxHeight - 8, cy - 48));
            const textX = boxX + boxWidth / 2;
            return (
              <g key={laneKey}>
                <path
                  d={`M ${cl.x1} ${cl.y1} Q ${cx} ${cy} ${cl.x2} ${cl.y2}`}
                  stroke={c}
                  strokeWidth={isSelected ? strokeWidth + 1.8 : isHovered ? strokeWidth + 1 : strokeWidth}
                  strokeDasharray={cl.transport_mode === 'AIR' ? '4 4' : undefined}
                  opacity={dimOthers ? 0.12 : isSelected || isHovered ? 1 : opacity}
                  fill="none"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredLane(laneKey)}
                  onMouseLeave={() => setHoveredLane(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedLane((prev) => (prev === laneKey ? null : laneKey));
                  }}
                />
                {isHovered || isSelected ? (
                  <g>
                    <rect
                      x={boxX}
                      y={boxY}
                      width={boxWidth}
                      height={boxHeight}
                      rx={6}
                      fill="#0f172a"
                      opacity={0.92}
                    />
                    <text
                      x={textX}
                      y={boxY + 15}
                      fontSize={11}
                      fontWeight={700}
                      fill={isSelected ? '#fde68a' : '#f8fafc'}
                      textAnchor="middle"
                    >
                      <tspan x={textX} dy={0}>
                        {cl.origin_plant_name}
                      </tspan>
                      <tspan x={textX} dy={14} fontSize={10} fontWeight={600} fill="#cbd5e1">
                        {laneInfo}
                      </tspan>
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* plants */}
          {plants.map((p) => {
            const pos = positions.get(p.plant_id);
            if (!pos) return null;
            const isDest = p.plant_id === destPlant;
            const isSource = candidateLines.some((cl) => cl.origin_plant_id === p.plant_id);
            const inFocus = focusIds.has(p.plant_id);
            const fill = isDest ? '#dc2626' : isSource ? '#f59e0b' : '#94a3b8';
            const opacity = inFocus ? 1 : 0.35;
            return (
              <g key={p.plant_id} opacity={opacity}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isDest ? 10 : isSource ? 8 : 5}
                  fill={fill}
                  stroke="#fff"
                  strokeWidth={2}
                  style={{ filter: 'drop-shadow(0 2px 4px rgba(15,23,42,.25))' }}
                />
                {inFocus ? (
                  <text
                    x={pos.x}
                    y={pos.y + 22}
                    fontSize={11}
                    fontWeight={700}
                    fill={isDest ? '#dc2626' : '#0f172a'}
                    textAnchor="middle"
                    style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}
                  >
                    {p.city}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* legend */}
          <g transform={`translate(${svg.padding}, ${svg.height - 26})`}>
            <LegendDot color="#dc2626" label="Destination" x={0} />
            <LegendDot color="#f59e0b" label="Source" x={110} />
            <LegendDot color="#94a3b8" label="Other" x={195} />
          </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

function LegendDot({ color, label, x }: { color: string; label: string; x: number }) {
  return (
    <g transform={`translate(${x},0)`}>
      <circle cx={6} cy={6} r={5} fill={color} stroke="#fff" strokeWidth={1.5} />
      <text x={16} y={10} fontSize={11} fontWeight={600} fill="#475569">{label}</text>
    </g>
  );
}

function TransferModal({
  candidate, dest, qty, mode, onQty, onMode,
  submitting, mockResult, onCancel, onSubmit,
}: {
  candidate: TransferCandidate;
  dest: TransferCandidatesResponse;
  qty: number;
  mode: TransportMode;
  onQty: (v: number) => void;
  onMode: (v: TransportMode) => void;
  submitting: boolean;
  mockResult: { status: 'SUCCESS'; referenceId: string; message: string } | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const modeOption = candidate.all_modes.find((m) => m.transport_mode === mode) || candidate.all_modes[0];
  const totalCost = (modeOption?.cost_per_unit_usd || 0) * qty;

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(15,23,42,.45)',
        display: 'grid', placeItems: 'center',
      }}
    >
      <div className="card" style={{ width: 'min(620px, 92vw)', padding: 22 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>
          Create Stock Transfer Order
        </div>
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 14 }}>
          {candidate.origin_plant_name} <span style={{ color: '#94a3b8' }}>→</span> {dest.dest_plant_name}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Part">
            <div style={{ fontWeight: 600 }}>{dest.part_number}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>{dest.part_description}</div>
          </Field>
          <Field label="Available at origin (excl. safety)">
            <div style={{ fontWeight: 600 }}>{Math.max(0, candidate.origin_available_qty - candidate.origin_safety_stock)} EA</div>
          </Field>

          <Field label="Transport mode">
            <select value={mode} onChange={(e) => onMode(e.target.value as TransportMode)}>
              {candidate.all_modes.map((m) => (
                <option key={m.transport_mode} value={m.transport_mode}>
                  {m.transport_mode} — {formatDays(m.transit_days)} — ${m.cost_per_unit_usd.toFixed(2)}/EA
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Quantity (max ${candidate.protectable_qty || 0})`}>
            <input
              type="number"
              min={1}
              max={candidate.protectable_qty || 0}
              value={qty}
              onChange={(e) => onQty(Math.max(0, Math.min(candidate.protectable_qty || 0, Number(e.target.value) || 0)))}
            />
          </Field>

          <Field label="ETA">
            <div style={{ fontWeight: 600 }}>{formatDays(modeOption?.transit_days)}</div>
          </Field>
          <Field label="Estimated total cost">
            <div style={{ fontWeight: 700, fontSize: 18 }}>${totalCost.toFixed(2)}</div>
          </Field>
        </div>

        {mockResult ? (
          <div
            style={{
              marginTop: 12,
              border: '1px solid #86efac',
              background: '#f0fdf4',
              borderRadius: 10,
              padding: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#166534' }}>Created STO</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#166534' }}>{mockResult.status}</span>
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>SAP S/4HANA</div>
            <div style={{ fontSize: 11, color: '#0f172a', marginTop: 2 }}>
              Ref: <strong>{mockResult.referenceId}</strong>
            </div>
            <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>{mockResult.message}</div>
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          {mockResult ? (
            <button type="button" className="primary" onClick={onCancel}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
              <button type="button" className="primary" onClick={onSubmit} disabled={submitting || qty <= 0}>
                {submitting ? 'Creating...' : 'Create STO'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function OpenStosTable({ rows }: { rows: OpenStoRow[] }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>In-Transit Stock Transfer Orders</div>
      {rows.length === 0 ? (
        <div style={{ color: '#475569', fontSize: 13 }}>No open STOs.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>STO</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Part</th>
                <th>Qty</th>
                <th>Mode</th>
                <th>ETA</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sto_id + r.sto_line_id}>
                  <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.sto_id}</td>
                  <td style={{ padding: '8px 12px' }}>{r.origin_plant_id}</td>
                  <td style={{ padding: '8px 12px' }}>{r.dest_plant_id}</td>
                  <td style={{ padding: '8px 12px' }}>{r.part_number}</td>
                  <td style={{ padding: '8px 12px' }}>{Math.round(r.qty_requested)}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ background: MODE_COLORS[r.transport_mode] + '22', color: MODE_COLORS[r.transport_mode], padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{r.transport_mode}</span>
                  </td>
                  <td style={{ padding: '8px 12px' }}>{r.expected_arrival_date || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ fontWeight: 700, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#eef2ff', color: '#4338ca' }}>{r.sto_status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
