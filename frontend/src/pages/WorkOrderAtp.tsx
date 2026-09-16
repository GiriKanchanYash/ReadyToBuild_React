import { useEffect, useMemo, useRef, useState } from 'react';
import { ctbApi } from '../api/ctbApi';
import type { WorkOrderDetail, WorkOrder } from '../types/ctb';
import StatusBadge from '../components/StatusBadge';

export default function WorkOrderAtp() {
  const [weeks, setWeeks] = useState<string[]>([]);
  const [week, setWeek] = useState<string>('');

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [woId, setWoId] = useState<string>('');

  const [detail, setDetail] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadingTimerRef = useRef<number | null>(null);

  const load = async (id: string) => {
    if (!id) return;
    setError(null);
    setLoading(false);

    // Avoid a loader "flash" when data comes from cache quickly.
    if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = window.setTimeout(() => setLoading(true), 200);
    try {
      const d = await ctbApi.workOrderDetail(id);
      setDetail(d as WorkOrderDetail);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setDetail(null);
    } finally {
      if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
      setLoading(false);
    }
  };

  const loadFilters = async () => {
    setError(null);
    try {
      const f = await ctbApi.filters();
      const ws = Array.isArray(f.weeks) ? f.weeks : [];
      setWeeks(ws);
      if (!week) {
        setWeek(ws[0] || '');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load week filters');
    }
  };

  const loadWorkOrdersForWeek = async (w: string) => {
    setError(null);
    try {
      // Backend uses week as filter for the work orders list.
      const wo = await ctbApi.workOrders({ week: w });
      setWorkOrders(Array.isArray(wo) ? wo : []);
      setWoId('');
      setDetail(null);
    } catch (err: unknown) {
      setWorkOrders([]);
      setWoId('');
      setDetail(null);
      setError(err instanceof Error ? err.message : 'Failed to load work orders for week');
    }
  };

  useEffect(() => {
    loadFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!week) return;
    loadWorkOrdersForWeek(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  useEffect(() => {
    if (woId) load(woId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [woId]);

  const statusColor = (s: string) =>
    s === 'OK' ? '#166534'
      : s === 'WITH_DELIVERY' ? '#2563eb'
      : s === 'PARTIAL' ? '#92400e'
      : s === 'USING SAFETY' ? '#92400e'
      : '#dc2626';
  const statusBg = (s: string) =>
    s === 'OK' ? '#dcfce7'
      : s === 'WITH_DELIVERY' ? '#dbeafe'
      : s === 'PARTIAL' ? '#fef3c7'
      : s === 'USING SAFETY' ? '#fef3c7'
      : '#fee2e2';

  const weeklyRows = detail?.weekly_build_sequence || [];
  const maxBuildWeek = weeklyRows.length ? Math.max(...weeklyRows.map((r) => Number(r.build_week || 0))) : 0;

  const computedPlannedEndDate = useMemo(() => {
    // Streamlit parity: calculate expected completion based on start-date's week alignment
    // plus "how many build weeks" (max BUILD_WEEK) from BUILD_SEQUENCE.
    const startStr = detail?.planned_start_date?.slice(0, 10);
    if (!startStr) return detail?.planned_end_date?.slice(0, 10) || 'N/A';
    const startDate = new Date(`${startStr}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) return detail?.planned_end_date?.slice(0, 10) || 'N/A';

    const day = (startDate.getDay() + 6) % 7; // Monday=0
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() - day);

    const effectiveMaxWeek = maxBuildWeek > 0 ? maxBuildWeek : 4; // Streamlit default 4
    const endDate = new Date(weekStart);
    endDate.setDate(endDate.getDate() + (effectiveMaxWeek - 1) * 7 + 6);

    const yyyy = endDate.getFullYear();
    const mm = String(endDate.getMonth() + 1).padStart(2, '0');
    const dd = String(endDate.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, [detail?.planned_start_date, detail?.planned_end_date, maxBuildWeek]);
  const weeklyGroups = weeklyRows.reduce<Record<string, typeof weeklyRows>>((acc, row) => {
    const key = `${row.build_week}|${row.build_stage}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
  const weeklyKeys = Object.keys(weeklyGroups).sort((a, b) => {
    const wa = Number(a.split('|')[0]);
    const wb = Number(b.split('|')[0]);
    return wa - wb;
  });

  const woStatusIcon = (s?: string) => (s === 'READY' ? '🟢' : s === 'PARTIAL' ? '🟡' : '🔴');
  const woStatusColor = (s?: string) => (s === 'READY' ? '#166534' : s === 'PARTIAL' ? '#92400e' : '#dc2626');
  const selectedWoStatus = workOrders.find((w) => w.WORK_ORDER_ID === woId)?.ctb_status || '';

  const resetFilters = () => {
    const firstWeek = weeks[0] || '';
    setWeek(firstWeek);
    setWoId('');
    setDetail(null);
  };

  return (
    <div>
      <div className="page-hero">
        <div className="page-hero-title">Work Order CTB</div>
        <div className="page-hero-subtitle">
          Analyze material availability and clear-to-build status for a specific work order.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 3fr 1fr',
          gap: 12,
          marginBottom: 10,
          alignItems: 'end',
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 6 }}>Week</div>
          <select
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', border: '1px solid #e5e7eb', borderRadius: 10 }}
          >
            {(weeks || []).map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 6 }}>Work Order</div>
          <select
            value={woId}
            onChange={(e) => setWoId(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '1px solid #e5e7eb',
              borderRadius: 10,
              color: woId ? woStatusColor(selectedWoStatus) : '#111827',
              fontWeight: woId ? 700 : 500,
            }}
            disabled={workOrders.length === 0}
          >
            <option value="">{workOrders.length ? 'Select a work order...' : 'No work orders found'}</option>
            {workOrders.map((wo) => (
              <option key={wo.WORK_ORDER_ID} value={wo.WORK_ORDER_ID}>
                {woStatusIcon(wo.ctb_status)} {wo.WORK_ORDER_ID} - P{wo.PRIORITY}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button className="secondary" type="button" onClick={resetFilters} style={{ width: '100%' }}>
            Reset
          </button>
        </div>
      </div>
      {loading && <div className="loading">Loading work order...</div>}
      {error && <div className="error-msg">{error}</div>}

      {detail && detail.WORK_ORDER_ID && (
        <>
          {/* Header */}
          <div
            className="card"
            style={{
              marginBottom: 20,
              background: 'linear-gradient(135deg, #dbeafe 0%, #e0f2fe 100%)',
              borderRadius: 16,
              padding: 24,
              border: '1px solid #bfdbfe',
              boxShadow: 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>WORK ORDER</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#1e3a5f' }}>
                  {detail.WORK_ORDER_ID}
                </div>
                <div style={{ color: '#0f172a', fontSize: 14, marginTop: 4 }}>
                  Product: {detail.PRODUCT_ID} | Plant: {detail.PLANT_ID} | Priority: {detail.PRIORITY}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: detail.ctb_status === 'READY' ? '#166534' : '#dc2626' }}>
                  {detail.can_build_qty}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Can Build (of {detail.PLANNED_QTY} planned)
                </div>
              </div>
            </div>
          </div>

          {/* KPI cards (separate row like Streamlit) */}
          <div className="grid-5" style={{ marginBottom: 20 }}>
            {(() => {
              const calc_ctb_status = detail.ctb_status;
              const status_bg =
                calc_ctb_status === 'READY' ? '#DCFCE7' : calc_ctb_status === 'PARTIAL' ? '#FEF3C7' : '#FEE2E2';
              const status_color =
                calc_ctb_status === 'READY' ? '#166534' : calc_ctb_status === 'PARTIAL' ? '#92400e' : '#dc2626';

              const is_blocked = calc_ctb_status === 'BLOCKED';

              const prod_status = detail.production_status || 'PENDING';
              const prod_status_bg =
                prod_status === 'IN_PRODUCTION'
                  ? '#DCFCE7'
                  : prod_status === 'PARTIAL_PRODUCTION' || prod_status === 'SCHEDULED'
                    ? '#FEF3C7'
                    : '#FEE2E2';
              const prod_status_color =
                prod_status === 'IN_PRODUCTION'
                  ? '#166534'
                  : prod_status === 'PARTIAL_PRODUCTION' || prod_status === 'SCHEDULED'
                    ? '#92400e'
                    : '#dc2626';
              const prod_status_label = prod_status.replace(/_/g, ' ');

              const startStr = detail.planned_start_date?.slice(0, 10) || 'N/A';

              return (
                <>
                  <div style={{ background: '#DCFCE7', borderRadius: 12, padding: 12, textAlign: 'center', height: 70, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>PLANNED QTY</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: '#166534' }}>{detail.PLANNED_QTY}</div>
                  </div>

                  <div style={{ background: status_bg, borderRadius: 12, padding: 12, textAlign: 'center', height: 70, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>CAN BUILD</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: status_color }}>{detail.can_build_qty}</div>
                  </div>

                  <div style={{ background: is_blocked ? '#f1f5f9' : '#dbeafe', borderRadius: 12, padding: 12, textAlign: 'center', height: 70, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>START DATE</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: is_blocked ? '#94a3b8' : '#1e40af' }}>
                      {is_blocked ? 'N/A' : startStr}
                    </div>
                  </div>

                  <div style={{ background: is_blocked ? '#f1f5f9' : '#E0E7FF', borderRadius: 12, padding: 12, textAlign: 'center', height: 70, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>EXP. COMPLETION</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: is_blocked ? '#94a3b8' : '#4338ca' }}>
                      {is_blocked ? 'N/A' : computedPlannedEndDate}
                    </div>
                  </div>

                  <div style={{ background: is_blocked ? '#f1f5f9' : prod_status_bg, borderRadius: 12, padding: 12, textAlign: 'center', height: 70, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>PROD. STATUS</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: is_blocked ? '#94a3b8' : prod_status_color }}>
                      {is_blocked ? 'PENDING' : prod_status_label}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Weekly Build Sequence */}
          <div className="card" style={{ marginTop: 20 }}>
            <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 700 }}>
              Weekly Build Sequence
            </h3>
            {weeklyKeys.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 13 }}>
                No weekly build sequence available for this work order.
              </div>
            ) : (
              weeklyKeys.map((k, idx) => {
                const rows = weeklyGroups[k];
                const [wkStr, stage] = k.split('|');
                const week = Number(wkStr);
                const weekSummary = detail?.weekly_build_summary?.[k];
                const planned = Number(weekSummary?.planned_qty ?? rows[0]?.planned_qty ?? 0);
                const canBuild = Number(
                  weekSummary?.week_can_build
                    ?? Math.max(
                      0,
                      Math.min(...rows.map((r) => Number(r.can_build ?? 0)), planned),
                    ),
                );
                const shortageCnt = weekSummary?.shortage_count
                  ?? rows.filter((r) => r.status === 'SHORTAGE').length;
                const partialCnt = weekSummary?.partial_count
                  ?? rows.filter((r) => r.status === 'PARTIAL').length;
                const safetyCnt = weekSummary?.safety_count
                  ?? rows.filter((r) => r.status === 'USING SAFETY').length;
                const weekReady = weekSummary
                  ? weekSummary.week_status === 'READY'
                  : canBuild >= planned;
                const weekPartial = weekSummary
                  ? weekSummary.week_status === 'PARTIAL'
                  : canBuild > 0 && canBuild < planned;
                const weekBlocked = weekSummary
                  ? weekSummary.week_status === 'BLOCKED'
                  : canBuild === 0;
                const partCount = weekSummary?.part_count ?? rows.length;
                const header = `Week ${week} - ${stage} | Planned: ${planned} | Can Build: ${canBuild} units (${partCount} parts)`;
                const summaryBg = weekReady ? '#f0fdf4' : weekBlocked ? '#fef2f2' : '#fffbeb';
                const summaryBorder = weekReady ? '#bbf7d0' : weekBlocked ? '#fecaca' : '#fde68a';
                const summaryColor = weekReady ? '#166534' : weekBlocked ? '#7f1d1d' : '#92400e';
                return (
                  <details key={k} open={idx === 0} style={{ marginBottom: 12 }}>
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontWeight: 700,
                        color: summaryColor,
                        background: summaryBg,
                        border: `1px solid ${summaryBorder}`,
                        borderRadius: 10,
                        padding: '10px 12px',
                      }}
                    >
                      {header}
                      {weekReady
                        ? ' - Ready'
                        : weekBlocked
                          ? ` | blocked${shortageCnt > 0 ? ` (${shortageCnt} parts short)` : ''}`
                          : weekPartial
                            ? ` | partial${partialCnt > 0 ? ` (${partialCnt} limiting parts)` : ''}`
                            : safetyCnt > 0
                              ? ` | ${safetyCnt} using safety`
                              : ' | constrained'}
                    </summary>
                    <div style={{ marginTop: 10 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Part ID</th>
                            <th>Description</th>
                            <th>Qty/Unit</th>
                            <th>Planned</th>
                            <th>On Hand</th>
                            <th>Safety Stock</th>
                            <th>Deliveries</th>
                            <th>HP Used</th>
                            <th>Eff Avail Qty</th>
                            <th>Qty Required</th>
                            <th>Can Build</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={`${k}-${r.part_number}`}>
                              <td style={{ fontWeight: 600 }}>{r.part_number}</td>
                              <td>{r.description}</td>
                              <td>{Number(r.qty_per_unit).toFixed(3).replace(/\.000$/, '')}</td>
                              <td>{r.planned_qty}</td>
                              <td>{r.on_hand}</td>
                              <td>{r.safety_stock}</td>
                              <td>{r.deliveries}</td>
                              <td>{r.hp_used}</td>
                              <td>{r.eff_avail_qty}</td>
                              <td>{r.qty_required}</td>
                              <td>{r.can_build}</td>
                              <td>
                                <span
                                  style={{
                                    display: 'inline-block',
                                    padding: '2px 10px',
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    background: statusBg(r.status),
                                    color: statusColor(r.status),
                                  }}
                                >
                                  {r.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
