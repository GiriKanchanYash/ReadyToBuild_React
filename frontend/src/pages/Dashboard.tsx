import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import { ctbApi } from '../api/ctbApi';
import type {
  KpiData,
  StatusDistribution,
  TopShortage,
  PriorityBreakdown,
  ProductionBoardItem,
  ProductionLane,
  BomConstraint,
  ConstraintSeverity,
  PrioritizationSimRow,
  PrioritizationImpactRow,
} from '../types/ctb';
import StatusBadge from '../components/StatusBadge';
import FilterBar from '../components/FilterBar';
import { useNavigate } from 'react-router-dom';

const STATUS_COLORS: Record<string, string> = {
  READY: '#7BC79A', // balanced green
  PARTIAL: '#F2B782', // balanced peach
  BLOCKED: '#E9A2B5', // balanced pink
};

type CoreCacheEntry = {
  kpis: KpiData;
  statusDist: StatusDistribution[];
  shortages: TopShortage[];
  priorityData: PriorityBreakdown[];
  board: ProductionBoardItem[];
  constraints: BomConstraint[];
};

const coreCache = new Map<string, CoreCacheEntry>();

export default function Dashboard() {
  const nav = useNavigate();
  const currentWeekStart = () => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  // Initialize to current week to prevent an initial "All Weeks" fetch.
  const [filters, setFilters] = useState({ product: '', plant: '', week: currentWeekStart() });
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [statusDist, setStatusDist] = useState<StatusDistribution[]>([]);
  const [shortages, setShortages] = useState<TopShortage[]>([]);
  const [priorityData, setPriorityData] = useState<PriorityBreakdown[]>([]);
  const [board, setBoard] = useState<ProductionBoardItem[]>([]);
  const [constraints, setConstraints] = useState<BomConstraint[]>([]);
  const [constraintTab, setConstraintTab] = useState<ConstraintSeverity>('CRITICAL');
  const [constraintPage, setConstraintPage] = useState(0);
  const [partsSearch, setPartsSearch] = useState('');
  const [includeDeliveries, setIncludeDeliveries] = useState(true);
  const [parts, setParts] = useState<import('../types/ctb').PartInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingParts, setLoadingParts] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dragOverHigh, setDragOverHigh] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [simWoId, setSimWoId] = useState<string | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simRows, setSimRows] = useState<PrioritizationSimRow[]>([]);
  const [simImpact, setSimImpact] = useState<PrioritizationImpactRow[]>([]);
  const [simStepIdx, setSimStepIdx] = useState(0);
  const simSteps = [
    'Loading work order and BOM requirements',
    'Checking current inventory by part',
    'Checking incoming deliveries window',
    'Reserving inventory for in-production work orders',
    'Reserving inventory for current high-priority work orders',
    'Computing can-build now vs after deliveries',
    'Identifying impacted work orders',
  ];

  const f = {
    product: filters.product || undefined,
    plant: filters.plant || undefined,
    week: filters.week || undefined,
  };

  const loadCore = useCallback(async () => {
    const key = `${f.product || 'ALL'}|${f.plant || 'ALL'}|${f.week || 'ALL'}`;
    const cached = coreCache.get(key);
    if (cached) {
      setKpis(cached.kpis);
      setStatusDist(cached.statusDist);
      setShortages(cached.shortages);
      setPriorityData(cached.priorityData);
      setBoard(cached.board);
      setConstraints(cached.constraints);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [k, sd, sh, pr, pb, bc] = await Promise.all([
        ctbApi.kpis(f),
        ctbApi.statusDistribution(f),
        ctbApi.topShortages(f),
        ctbApi.byPriority(f),
        ctbApi.productionBoard({ product: f.product, plant: f.plant }),
        ctbApi.bomConstraints(f),
      ]);
      setKpis(k);
      setStatusDist(sd);
      setShortages(sh);
      setPriorityData(pr);
      setBoard(pb);
      setConstraints(bc);
      coreCache.set(key, { kpis: k, statusDist: sd, shortages: sh, priorityData: pr, board: pb, constraints: bc });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [filters.product, filters.plant, filters.week]);

  const loadParts = useCallback(async () => {
    setLoadingParts(true);
    try {
      const pi = await ctbApi.partsInventory({
        product: f.product,
        plant: f.plant,
        week: f.week,
        include_deliveries: includeDeliveries,
        search: partsSearch || undefined,
        limit: 50,
      });
      setParts(pi);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load parts inventory');
    } finally {
      setLoadingParts(false);
    }
  }, [filters.product, filters.plant, filters.week, includeDeliveries, partsSearch]);

  const loadBoardOnly = useCallback(async () => {
    setLoadingBoard(true);
    try {
      const pb = await ctbApi.productionBoard({ product: f.product, plant: f.plant });
      setBoard(pb);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load production board');
    } finally {
      setLoadingBoard(false);
    }
  }, [filters.product, filters.plant]);

  useEffect(() => { loadCore(); }, [loadCore]);

  // Auto-focus the BOM constraints tab that actually has data.
  useEffect(() => {
    if (!constraints.length) return;
    const order: ConstraintSeverity[] = ['CRITICAL', 'HIGH', 'MODERATE'];
    const counts = constraints.reduce<Record<ConstraintSeverity, number>>(
      (acc, c) => {
        acc[c.severity] = (acc[c.severity] || 0) + 1;
        return acc;
      },
      { CRITICAL: 0, HIGH: 0, MODERATE: 0 },
    );
    const best = order.reduce((max, sev) => (counts[sev] > counts[max] ? sev : max), order[0]);
    setConstraintTab((prev) => (counts[prev] > 0 ? prev : best));
    setConstraintPage(0);
  }, [constraints]);

  // Debounce parts search/toggles so they only refresh the parts section
  useEffect(() => {
    const t = setTimeout(() => { loadParts(); }, 250);
    return () => clearTimeout(t);
  }, [loadParts]);

  const partsGrid = useMemo(() => {
    const byPart = new Map<string, {
      part_number: string;
      description: string;
      inv: number;
      ss: number;
      cells: Record<
        string,
        {
          balance: number;
          has_delivery: boolean;
          using_safety: boolean;
          /** True in the week to place a PO before projected shortage (lead time from PART_SUPPLY_VW). */
          place_po_week: boolean;
        }
      >;
    }>();
    const weekOrder: string[] = [];

    for (const p of parts) {
      if (!weekOrder.includes(p.week_label)) weekOrder.push(p.week_label);
      const row = byPart.get(p.part_number) ?? {
        part_number: p.part_number,
        description: p.description,
        inv: Number(p.inv),
        ss: Number(p.ss),
        cells: {},
      };
      row.cells[p.week_label] = {
        balance: Number(p.balance),
        has_delivery: Boolean(p.has_delivery),
        using_safety: Boolean(p.using_safety),
        place_po_week: Boolean(p.suggest_reorder),
      };
      byPart.set(p.part_number, row);
    }

    return { weekOrder, rows: Array.from(byPart.values()) };
  }, [parts]);

  const openSim = useCallback(async (woId: string) => {
    setSimWoId(woId);
    setSimOpen(true);
    setSimLoading(true);
    setSimStepIdx(0);
    setSimRows([]);
    setSimImpact([]);
    try {
      const [rows, impact] = await Promise.all([
        ctbApi.prioritizationSim(woId),
        ctbApi.prioritizationImpact(woId),
      ]);
      setSimRows(rows);
      setSimImpact(impact);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run simulation');
    } finally {
      setSimLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!simOpen || !simLoading) return;
    const t = window.setInterval(() => {
      setSimStepIdx((i) => (i < simSteps.length - 1 ? i + 1 : i));
    }, 500);
    return () => window.clearInterval(t);
  }, [simOpen, simLoading]);

  const confirmPrioritize = useCallback(async () => {
    if (!simWoId) return;
    setSimLoading(true);
    try {
      await ctbApi.prioritize(simWoId);
      // Recalculate everything (Streamlit parity)
      await ctbApi.refresh();
      // coreCache can otherwise keep showing the pre-prioritize production-board state.
      coreCache.clear();
      setSimOpen(false);
      setSimWoId(null);
      setSimRows([]);
      setSimImpact([]);
      await Promise.all([loadCore(), loadParts()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to prioritize');
    } finally {
      setSimLoading(false);
    }
  }, [simWoId, loadCore, loadParts]);

  const lanes: { key: ProductionLane; title: string; bg: string; border: string; color: string }[] = [
    { key: 'HIGH_PRIORITY', title: 'HIGH PRIORITY', bg: '#fef2f2', border: '#fecaca', color: '#991b1b' },
    { key: 'IN_PRODUCTION', title: 'IN PRODUCTION', bg: '#f0fdf4', border: '#bbf7d0', color: '#166534' },
    { key: 'YET_TO_START', title: 'YET TO START', bg: '#fefce8', border: '#fef08a', color: '#854d0e' },
    { key: 'NEXT_WEEK', title: 'NEXT WEEK', bg: '#e0f2fe', border: '#bae6fd', color: '#0369a1' },
  ];

  const statusChip = (status: string) => {
    const cfg: Record<string, { bg: string; color: string; label: string }> = {
      READY_NOW: { bg: '#dcfce7', color: '#166534', label: 'READY NOW' },
      READY_ON_DELIVERY: { bg: '#dbeafe', color: '#1d4ed8', label: 'READY ON DEL' },
      PARTIAL: { bg: '#fef3c7', color: '#92400e', label: 'PARTIAL' },
      READY: { bg: '#dcfce7', color: '#166534', label: 'READY' },
      BLOCKED: { bg: '#fee2e2', color: '#991b1b', label: 'BLOCKED' },
      UNKNOWN: { bg: '#f1f5f9', color: '#475569', label: 'UNKNOWN' },
    };
    const c = cfg[status] || cfg.UNKNOWN;
    return (
      <span
        style={{
          background: c.bg,
          color: c.color,
          fontSize: 9,
          fontWeight: 900,
          padding: '2px 6px',
          borderRadius: 8,
          display: 'inline-block',
          whiteSpace: 'nowrap',
        }}
      >
        {c.label}
      </span>
    );
  };

  const boardByLane = lanes.reduce<Record<string, ProductionBoardItem[]>>((acc, l) => {
    acc[l.key] = board.filter((x) => x.lane === l.key);
    return acc;
  }, {});

  if (loading) return <div className="loading">Loading dashboard...</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!kpis) return null;

  const countsBySeverity = constraints.reduce<Record<ConstraintSeverity, number>>(
    (acc, c) => {
      acc[c.severity] = (acc[c.severity] || 0) + 1;
      return acc;
    },
    { CRITICAL: 0, HIGH: 0, MODERATE: 0 },
  );

  const filteredConstraints = constraints.filter((c) => c.severity === constraintTab);
  const itemsPerPage = 8;
  const totalPages = Math.max(1, Math.ceil(filteredConstraints.length / itemsPerPage));
  const page = Math.min(constraintPage, totalPages - 1);
  const pageItems = filteredConstraints.slice(page * itemsPerPage, page * itemsPerPage + itemsPerPage);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Operations Overview</div>
          <div className="page-header-subtitle">
            End-to-end production readiness across priorities, constraints, and material risk.
          </div>
        </div>
        <div className="page-header-right">
          <FilterBar {...filters} onChange={setFilters} compact />
        </div>
      </div>

      {/* Production Board */}
      <div
        className="card"
        style={{
          marginBottom: 24,
          background: '#eaf3ff',
          border: '1px solid #bfd7ed',
          borderRadius: 16,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 12 }}>
          Production Board <span style={{ fontWeight: 700, color: '#6b7280' }}>(Drag & Drop Planning)</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
          {lanes.map((l) => {
            const items = boardByLane[l.key] || [];
            const isHigh = l.key === 'HIGH_PRIORITY';
            return (
              <div
                key={l.key}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e5e7eb',
                  borderRadius: 14,
                  padding: 10,
                }}
              >
                <div
                  style={{
                    background: l.bg,
                    border: `1px solid ${l.border}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 900, color: l.color }}>{l.title}</span>
                  <span
                    style={{
                      background: '#fff',
                      border: `1px solid ${l.border}`,
                      color: l.color,
                      fontSize: 10,
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {items.length}
                  </span>
                </div>

                <div
                  style={{
                    height: 350,
                    overflow: 'auto',
                    padding: 10,
                    paddingRight: 8,
                    background: isHigh && dragOverHigh ? '#ffd6dc' : l.bg,
                    border: `1px solid ${isHigh && dragOverHigh ? '#fb7185' : l.border}`,
                    borderRadius: 10,
                  }}
                  onDragOver={(e) => {
                    if (!isHigh) return;
                    e.preventDefault();
                    setDragOverHigh(true);
                  }}
                  onDragLeave={() => {
                    if (!isHigh) return;
                    setDragOverHigh(false);
                  }}
                  onDrop={(e) => {
                    if (!isHigh) return;
                    e.preventDefault();
                    setDragOverHigh(false);
                    const woId = e.dataTransfer.getData('text/plain');
                    if (woId) openSim(woId);
                  }}
                >
                  {items.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: 18 }}>
                      No work orders
                    </div>
                  ) : (
                    items.map((row) => {
                      const partsInfo =
                        row.parts_ready_with_del > row.parts_ready_now
                          ? `${row.parts_ready_now}/${row.total_parts} now | ${row.parts_ready_with_del}/${row.total_parts} w/del`
                          : `${row.parts_ready_now}/${row.total_parts} parts`;
                      return (
                        <div
                          key={row.WORK_ORDER_ID}
                          draggable={l.key !== 'HIGH_PRIORITY'}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', row.WORK_ORDER_ID);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          style={{
                            background: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: 8,
                            padding: 8,
                            marginBottom: 8,
                            boxShadow: 'none',
                            cursor: l.key !== 'HIGH_PRIORITY' ? 'grab' : 'default',
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
                            {row.WORK_ORDER_ID}
                          </div>
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            {row.PRODUCT_ID} | Qty: {row.PLANNED_QTY} | {row.planned_start_date?.slice(5, 10)}
                          </div>
                          <div style={{ fontSize: 11, marginTop: 6, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              {statusChip(row.planning_status)}
                              <span style={{ color: '#475569', fontWeight: 800 }}>{partsInfo}</span>
                            </span>
                            <span style={{ color: '#1e40af', fontWeight: 800 }}>
                              can build {row.can_build_qty}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prioritization Simulation Modal */}
      {simOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 2000,
          }}
          onMouseDown={() => {
            if (!simLoading) {
              setSimOpen(false);
              setSimWoId(null);
              setSimRows([]);
              setSimImpact([]);
            }
          }}
        >
          <div
            className="card"
            style={{ width: 'min(920px, 100%)', maxHeight: '85vh', overflow: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>
                Prioritize {simWoId || ''}
              </div>
              <button
                className="secondary"
                onClick={() => {
                  if (simLoading) return;
                  setSimOpen(false);
                  setSimWoId(null);
                  setSimRows([]);
                  setSimImpact([]);
                }}
              >
                Close
              </button>
            </div>
            <div style={{ marginTop: 8, color: '#64748b', fontSize: 13, fontWeight: 600 }}>
              Simulation: Can we build this NOW vs AFTER DELIVERIES?
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
              Checking current inventory and upcoming deliveries after reserving for in-production & high-priority WOs
            </div>

            {simLoading && (
              <div style={{ padding: 16 }}>
                <div className="loading" style={{ padding: 8 }}>Analyzing...</div>
                <div style={{ marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc', padding: 10 }}>
                  {simSteps.map((s, idx) => {
                    const done = idx < simStepIdx;
                    const active = idx === simStepIdx;
                    return (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: done ? '#166534' : active ? '#1d4ed8' : '#64748b', fontWeight: active ? 800 : 600, marginBottom: idx === simSteps.length - 1 ? 0 : 6 }}>
                        <span>{done ? '✓' : active ? '⟳' : '•'}</span>
                        <span>{s}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!simLoading && simRows.length > 0 && (
              (() => {
                const planned = Number(simRows[0].planned_qty ?? 0);
                const canNow = Math.min(planned, Math.min(...simRows.map((r) => Number(r.can_build_now ?? 0))));
                const canAfter = Math.min(planned, Math.min(...simRows.map((r) => Number(r.can_build_after_delivery ?? 0))));
                const partsShortNow = simRows.filter((r) =>
                  ['READY_ON_DELIVERY', 'PARTIAL_NOW', 'PARTIAL_ON_DELIVERY', 'BLOCKED'].includes(r.part_status),
                );
                const planningStatus =
                  canNow >= planned ? 'READY_NOW'
                    : canAfter >= planned ? 'READY_ON_DELIVERY'
                      : 'BLOCKED';
                const banner =
                  planningStatus === 'READY_NOW'
                    ? { bg: '#f0fdf4', border: '#22c55e', text: 'READY NOW - Full build can be completed if started now.' }
                    : planningStatus === 'READY_ON_DELIVERY'
                      ? { bg: '#eff6ff', border: '#3b82f6', text: 'READY ON DELIVERY - Full build completes once deliveries arrive.' }
                      : { bg: '#fef2f2', border: '#ef4444', text: 'BLOCKED - Full build cannot be completed now or on delivery.' };

                return (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ background: '#f0fdf4', border: '2px solid #22c55e', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#166534', fontWeight: 800 }}>CAN BUILD NOW</div>
                        <div style={{ fontSize: 30, fontWeight: 900, color: '#166534' }}>{canNow}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>of {planned} planned</div>
                      </div>
                      <div style={{ background: '#dbeafe', border: '2px solid #3b82f6', borderRadius: 12, padding: 12, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 800 }}>AFTER DELIVERIES</div>
                        <div style={{ fontSize: 30, fontWeight: 900, color: '#1d4ed8' }}>{canAfter}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>of {planned} planned</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 12, background: banner.bg, borderLeft: `4px solid ${banner.border}`, borderRadius: 10, padding: 12, fontWeight: 700 }}>
                      {banner.text}
                    </div>

                    {partsShortNow.length > 0 && (
                      <div style={{ marginTop: 14 }}>
                        <div style={{ fontWeight: 900, marginBottom: 8 }}>Part-Level Details</div>
                        {partsShortNow.slice(0, 30).map((r) => {
                          const statusColors: Record<string, string> = {
                            READY_NOW: '#166534',
                            READY_ON_DELIVERY: '#0369a1',
                            PARTIAL_NOW: '#d97706',
                            PARTIAL_ON_DELIVERY: '#7c3aed',
                            BLOCKED: '#dc2626',
                          };
                          const c = statusColors[r.part_status] || '#64748b';
                          return (
                            <div key={r.part_number} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                                <span style={{ fontWeight: 900 }}>{r.part_number}</span>
                                <span style={{ background: c + '20', color: c, fontSize: 11, fontWeight: 900, padding: '2px 10px', borderRadius: 999 }}>
                                  {r.part_status.split('_').join(' ')}
                                </span>
                              </div>
                              <div style={{ fontSize: 12, color: '#475569', marginTop: 6 }}>
                                Need: <strong>{Math.trunc(Number(r.required_qty))}</strong> | Available Now: <strong>{Math.trunc(Number(r.available_now))}</strong> | Incoming: <strong>{Math.trunc(Number(r.incoming_qty))}</strong> | After Delivery: <strong>{Math.trunc(Number(r.available_after_delivery))}</strong>
                              </div>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                                Short Now: {Math.trunc(Number(r.shortage_now))} | Short After: {Math.trunc(Number(r.shortage_after_delivery))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {simImpact.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                          <div style={{ fontWeight: 900 }}>
                            Impacted Work Orders ({simImpact.length})
                          </div>
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>
                            Other WOs at this plant whose can-build drops if you promote {simWoId}
                          </div>
                        </div>
                        <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 10, padding: 10 }}>
                          {simImpact.slice(0, 30).map((r) => {
                            const lostPct =
                              r.current_can_build > 0
                                ? Math.round((r.lost_build_qty / r.current_can_build) * 100)
                                : 0;
                            return (
                              <div
                                key={r.WORK_ORDER_ID}
                                style={{
                                  background: '#fff',
                                  border: '1px solid #fde68a',
                                  borderRadius: 10,
                                  padding: 10,
                                  marginBottom: 8,
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontWeight: 900, color: '#0f172a' }}>{r.WORK_ORDER_ID}</span>
                                    <span style={{ fontSize: 11, color: '#64748b' }}>
                                      {r.PRODUCT_ID} · Qty {r.PLANNED_QTY} · Priority {r.PRIORITY} · Start {r.planned_start_date?.slice(5, 10)}
                                    </span>
                                  </div>
                                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                                    <div style={{ textAlign: 'center' }}>
                                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800 }}>NOW</div>
                                      <div style={{ fontWeight: 900, color: '#166534' }}>{r.current_can_build}</div>
                                    </div>
                                    <div style={{ fontSize: 14, color: '#94a3b8' }}>→</div>
                                    <div style={{ textAlign: 'center' }}>
                                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800 }}>AFTER</div>
                                      <div style={{ fontWeight: 900, color: '#b45309' }}>{r.new_can_build}</div>
                                    </div>
                                    <div
                                      style={{
                                        background: '#fee2e2',
                                        color: '#991b1b',
                                        fontWeight: 900,
                                        fontSize: 12,
                                        padding: '4px 10px',
                                        borderRadius: 999,
                                      }}
                                    >
                                      -{r.lost_build_qty} ({lostPct}%)
                                    </div>
                                  </div>
                                </div>
                                <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
                                  Shared parts ({r.shared_part_count}): {r.shared_parts}
                                </div>
                              </div>
                            );
                          })}
                          {simImpact.length > 30 && (
                            <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 4 }}>
                              + {simImpact.length - 30} more...
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {simImpact.length === 0 && !simLoading && (
                      <div
                        style={{
                          marginTop: 16,
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          color: '#166534',
                          padding: 10,
                          borderRadius: 10,
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        No other work orders are impacted by promoting {simWoId}.
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 16 }}>
                      <button className="primary" disabled={simLoading} onClick={confirmPrioritize}>
                        Confirm Prioritize
                      </button>
                      <button
                        className="secondary"
                        disabled={simLoading}
                        onClick={() => {
                          setSimOpen(false);
                          setSimWoId(null);
                          setSimRows([]);
                          setSimImpact([]);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}

      {/* BOM Constraints */}
      <div
        className="card"
        style={{
          marginBottom: 24,
          background: '#f7f0ff',
          border: '1px solid #d9c6ff',
          borderRadius: 18,
          padding: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            BOM Constraints <span style={{ fontWeight: 700, color: '#6b7280' }}>(BOM blocking production)</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 12, marginBottom: 16 }}>
          {(['CRITICAL', 'HIGH', 'MODERATE'] as ConstraintSeverity[]).map((t) => (
            <button
              key={t}
              className="secondary"
              style={{
                fontSize: 12,
                padding: '10px 16px',
                borderRadius: 999,
                background: constraintTab === t ? '#e5e7eb' : '#e5e7eb',
                color: '#111827',
                fontWeight: constraintTab === t ? 900 : 800,
                flex: 1,
              }}
              onClick={() => {
                setConstraintTab(t);
                setConstraintPage(0);
              }}
            >
              {t[0] + t.slice(1).toLowerCase()} ({countsBySeverity[t] || 0})
            </button>
          ))}
        </div>

        {pageItems.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: 28 }}>
            No {constraintTab.toLowerCase()} constraints
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            {pageItems.map((c, idx) => {
              const tag =
                constraintTab === 'CRITICAL'
                  ? { bg: '#fff1f2', color: '#b42318' } // soft rose
                  : constraintTab === 'HIGH'
                    ? { bg: '#fffbeb', color: '#92400E' } // soft amber
                    : { bg: '#eff6ff', color: '#1e40af' }; // soft blue
              return (
                <div
                  key={`${c.WORK_ORDER_ID}-${idx}`}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 12,
                    padding: 12,
                    background: tag.bg,
                    cursor: 'pointer',
                  }}
                  role="button"
                  tabIndex={0}
                onClick={() =>
                  nav(
                    `/bom?product=${encodeURIComponent(c.PRODUCT_ID)}&wo=${encodeURIComponent(
                      c.WORK_ORDER_ID,
                    )}&constraint=${encodeURIComponent(c.constraint_part)}`,
                  )
                }
                  onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ')
                    nav(
                      `/bom?product=${encodeURIComponent(c.PRODUCT_ID)}&wo=${encodeURIComponent(
                        c.WORK_ORDER_ID,
                      )}&constraint=${encodeURIComponent(c.constraint_part)}`,
                    );
                  }}
                >
                  <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ background: tag.bg, color: tag.color, fontSize: 10, padding: '2px 8px', borderRadius: 999, fontWeight: 900 }}>
                      L{c.BOM_LEVEL}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#7c3aed' }}>Priority: {c.PRIORITY}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: '#1e40af' }}>
                      {c.WORK_ORDER_ID}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a' }}>{c.constraint_part}</div>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>→ {c.PRODUCT_ID}</div>

                  <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748b' }}>Required</div>
                      <div style={{ fontSize: 14, fontWeight: 800 }}>{c.required_qty}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748b' }}>Available</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#166534' }}>{c.available_qty}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748b' }}>Safety</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b' }}>{c.safety_stock}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748b' }}>Incoming</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#2563eb' }}>{c.total_deliveries}</div>
                    </div>
                  </div>

                  {/* Button removed; the whole card is clickable for BOM navigation. */}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <button
            className="secondary"
            disabled={page <= 0}
            onClick={() => setConstraintPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <div style={{ color: '#6b7280', fontWeight: 600 }}>
            {page + 1} of {totalPages}
          </div>
          <button
            className="secondary"
            disabled={page >= totalPages - 1}
            onClick={() => setConstraintPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {/* Parts Inventory (Priority-Based Allocation) */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>
          Part Inventory <span style={{ fontWeight: 700, color: '#6b7280' }}>(Priority-Based Allocation)</span>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#ef4444', display: 'inline-block' }} />
            Shortage (negative)
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#fcd34d', display: 'inline-block' }} />
            Using Safety Stock
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#16a34a', display: 'inline-block' }} />
            Delivery Received
          </span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6b7280', fontSize: 12, fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#D0C4DF', display: 'inline-block' }} />
            Suggested PO week (lead time)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            value={partsSearch}
            onChange={(e) => setPartsSearch(e.target.value)}
            placeholder="Search by part number or description..."
            style={{
              flex: 1,
              minWidth: 260,
              padding: '10px 14px',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              fontSize: 14,
              outline: 'none',
            }}
          />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#475569', fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={includeDeliveries}
              onChange={(e) => setIncludeDeliveries(e.target.checked)}
            />
            Include Deliveries
          </label>
        </div>
        <div className="table-scroll" style={{ maxHeight: 420, overflow: 'auto' }}>
          <table className="table-minimal">
            <thead>
              <tr>
                <th>PN</th>
                <th>Desc</th>
                <th>Inv</th>
                <th>SS</th>
                {partsGrid.weekOrder.map((w) => (
                  <th key={w}>{w}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {partsGrid.rows.map((r) => (
                <tr key={r.part_number}>
                  <td style={{ fontWeight: 600, color: '#212129' }}>{r.part_number}</td>
                  <td style={{ color: 'rgba(33,33,41,.78)', fontSize: 12 }}>{r.description?.slice(0, 22) || '-'}</td>
                  <td style={{ fontWeight: 500 }}>{r.inv}</td>
                  <td style={{ fontWeight: 500 }}>{r.ss}</td>
                  {partsGrid.weekOrder.map((w) => {
                    const cell = r.cells[w];
                    const v = cell?.balance ?? 0;
                    const hasDelivery = Boolean(cell?.has_delivery);
                    const usingSafety = Boolean(cell?.using_safety);
                    const placePoWeek = Boolean(cell?.place_po_week);
                    let textColor = 'rgba(33,33,41,.88)';
                    let fontWeight: 500 | 600 | 700 = 500;
                    if (v < 0) {
                      textColor = '#b91c1c';
                      fontWeight = 700;
                    } else if (hasDelivery) {
                      textColor = '#15803d';
                      fontWeight = 700;
                    } else if (usingSafety) {
                      textColor = '#b45309';
                      fontWeight = 700;
                    }
                    const pill: React.CSSProperties = {
                      fontWeight,
                      color: textColor,
                      borderRadius: 999,
                      padding: '3px 8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 34,
                      background: placePoWeek ? '#D0C4DF' : 'transparent',
                    };
                    return (
                      <td key={w} style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                        <span style={pill}>{v}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid-2" style={{ marginBottom: 24 }}>
        {/* Donut */}
        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 700 }}>CTB Status Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <defs>
                <filter id="donutShadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.2" />
                </filter>
              </defs>
              <Pie
                data={statusDist}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={100}
                paddingAngle={2}
                stroke="#ffffff"
                strokeWidth={2}
                style={{ filter: 'url(#donutShadow)' }}
                label={({ status, count }) => `${status} (${count})`}
              >
                {statusDist.map((d) => (
                  <Cell key={d.status} fill={STATUS_COLORS[d.status] || '#ccc'} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top Shortages */}
        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 700 }}>Top Shortage Parts</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={shortages} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(33,33,41,.18)" />
              <XAxis type="number" />
              <YAxis dataKey="part_number" type="category" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="shortage_qty" fill="#E9A2B5" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* CTB by Priority */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 700 }}>CTB Status by Priority</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={priorityData}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(33,33,41,.16)" />
            <XAxis dataKey="PRIORITY" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="ready" stackId="a" fill="#7BC79A" />
            <Bar dataKey="partial" stackId="a" fill="#F2B782" />
            <Bar dataKey="blocked" stackId="a" fill="#E9A2B5" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
