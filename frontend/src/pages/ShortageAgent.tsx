import { useEffect, useMemo, useRef, useState } from 'react';
import { aiApi, type ShortageQueueItem } from '../api/aiApi';

export default function ShortageAgent() {
  type IntegrationEvent = {
    id: string;
    type: 'po' | 'email';
    title: string;
    system: string;
    status: 'SUCCESS' | 'FAILED';
    referenceId: string;
    details: string;
    createdAt: string;
  };
  const [rows, setRows] = useState<ShortageQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ShortageQueueItem | null>(null);
  const [rec, setRec] = useState<string | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<'all' | 'act_now' | 'plan' | 'monitor'>('all');
  const [poMsg, setPoMsg] = useState<string | null>(null);
  const [poLoading, setPoLoading] = useState(false);
  const [emailDraft, setEmailDraft] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [resolveLoading, setResolveLoading] = useState(false);
  const [showPoConfirm, setShowPoConfirm] = useState(false);
  const [poPreview, setPoPreview] = useState<any[]>([]);
  const [integrationEvents, setIntegrationEvents] = useState<IntegrationEvent[]>([]);
  const [poPreviewLoading, setPoPreviewLoading] = useState(false);
  const loadingTimerRef = useRef<number | null>(null);
  const addIntegrationEvent = (event: Omit<IntegrationEvent, 'id' | 'createdAt'>, replace = false) => {
    const now = new Date();
    const entry: IntegrationEvent = {
      ...event,
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now.toLocaleString(),
    };
    setIntegrationEvents((prev) => (replace ? [entry] : [entry, ...prev]).slice(0, 8));
  };
  const actionLabel = (g?: string) => (g || 'UNKNOWN').replace(/_/g, ' ');
  const formatRecommendationHtml = (text: string) =>
    String(text || '')
      // Streamlit-style formatting: keep model-provided <strong> and convert markdown tokens.
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(
        /(SITUATION ASSESSMENT|IMMEDIATE ACTIONS \(ranked by speed\)|RECOMMENDED SUPPLIER|VENDOR COMMUNICATION DRAFT|TIMELINE & RESOLUTION)/g,
        '<strong>$1</strong>'
      )
      .replace(/\n/g, '<br/>');
  const pick = <T,>(r: any, lower: string, upper: string, fallback: T): T => {
    const v = r?.[lower] ?? r?.[upper];
    return (v ?? fallback) as T;
  };
  const normalizeRow = (r: any): ShortageQueueItem => ({
    part_number: String(pick(r, 'part_number', 'PART_NUMBER', '')),
    shortage_type: pick(r, 'shortage_type', 'SHORTAGE_TYPE', 'CURRENT'),
    affected_wo_count: Number(pick(r, 'affected_wo_count', 'AFFECTED_WO_COUNT', 0)),
    shortage_qty: Number(pick(r, 'shortage_qty', 'SHORTAGE_QTY', 0)),
    highest_priority: Number(pick(r, 'highest_priority', 'HIGHEST_PRIORITY', 0)),
    affected_products: pick(r, 'affected_products', 'AFFECTED_PRODUCTS', null),
    affected_plants: pick(r, 'affected_plants', 'AFFECTED_PLANTS', null),
    shortage_date: pick(r, 'shortage_date', 'SHORTAGE_DATE', null),
    days_until_shortage: Number(pick(r, 'days_until_shortage', 'DAYS_UNTIL_SHORTAGE', 0)),
    unit_cost: Number(pick(r, 'unit_cost', 'UNIT_COST', 0)),
    business_impact_score: Number(pick(r, 'business_impact_score', 'BUSINESS_IMPACT_SCORE', 0)),
    action_group: pick(r, 'action_group', 'ACTION_GROUP', 'MONITOR'),
  });

  useEffect(() => {
    setError(null);
    setLoading(false);
    if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
    loadingTimerRef.current = window.setTimeout(() => setLoading(true), 200);
    aiApi.shortageQueue()
      .then((data) => setRows((Array.isArray(data) ? data : []).map(normalizeRow)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => {
        if (loadingTimerRef.current) window.clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
        setLoading(false);
      });
  }, []);

  const counts = useMemo(() => {
    const c = { ACT_NOW: 0, PLAN_THIS_WEEK: 0, MONITOR: 0 };
    for (const r of rows) {
      const g = r.action_group;
      if (g === 'ACT_NOW' || g === 'PLAN_THIS_WEEK' || g === 'MONITOR') {
        c[g] += 1;
      }
    }
    return c;
  }, [rows]);
  const filteredRows = useMemo(() => {
    if (actionFilter === 'act_now') return rows.filter((r) => r.action_group === 'ACT_NOW');
    if (actionFilter === 'plan') return rows.filter((r) => r.action_group === 'PLAN_THIS_WEEK');
    if (actionFilter === 'monitor') return rows.filter((r) => r.action_group === 'MONITOR');
    return rows;
  }, [rows, actionFilter]);

  const generate = async (item: ShortageQueueItem) => {
    setSelected(item);
    setRec(null);
    setPoMsg(null);
    setEmailDraft(null);
    setShowPoConfirm(false);
    setPoPreview([]);
    setRecLoading(true);
    try {
      const r = await aiApi.recommendShortage(item);
      setRec(r.response || '(no response)');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate recommendation');
    } finally {
      setRecLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading shortage agent...</div>;
  if (error) return <div className="error-msg">{error}</div>;

  return (
    <div>
      <div className="page-hero">
        <div className="page-hero-title">Shortage Resolution Agent</div>
        <div className="page-hero-subtitle">
          Unified priority queue combining current and predicted shortages
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 18 }}>
        <div className="kpi-card" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
          <div className="kpi-label" style={{ color: '#991b1b' }}>ACT NOW</div>
          <div className="kpi-value" style={{ color: '#7f1d1d' }}>{counts.ACT_NOW}</div>
          <div style={{ fontSize: 10, color: '#991b1b', fontWeight: 700 }}>{'<= 7 days'}</div>
        </div>
        <div className="kpi-card" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
          <div className="kpi-label" style={{ color: '#92400e' }}>PLAN THIS WEEK</div>
          <div className="kpi-value" style={{ color: '#78350f' }}>{counts.PLAN_THIS_WEEK}</div>
          <div style={{ fontSize: 10, color: '#92400e', fontWeight: 700 }}>8-14 days</div>
        </div>
        <div className="kpi-card" style={{ background: '#e0f2fe', borderColor: '#bae6fd' }}>
          <div className="kpi-label" style={{ color: '#0369a1' }}>MONITOR</div>
          <div className="kpi-value" style={{ color: '#0c4a6e' }}>{counts.MONITOR}</div>
          <div style={{ fontSize: 10, color: '#0369a1', fontWeight: 700 }}>{'>'} 14 days</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 30%) minmax(0, 70%)', gap: 16 }}>
        <div className="card" style={{ alignSelf: 'start' }}>
          <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>
            Priority Queue ({rows.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
            <button className={`shortage-filter-btn ${actionFilter === 'all' ? 'primary' : 'secondary'}`} onClick={() => setActionFilter('all')}>All ({rows.length})</button>
            <button className={`shortage-filter-btn ${actionFilter === 'act_now' ? 'primary' : 'secondary'}`} onClick={() => setActionFilter('act_now')}>Now ({counts.ACT_NOW})</button>
            <button className={`shortage-filter-btn ${actionFilter === 'plan' ? 'primary' : 'secondary'}`} onClick={() => setActionFilter('plan')}>Plan ({counts.PLAN_THIS_WEEK})</button>
            <button className={`shortage-filter-btn ${actionFilter === 'monitor' ? 'primary' : 'secondary'}`} onClick={() => setActionFilter('monitor')}>Later ({counts.MONITOR})</button>
          </div>
          <div
            className="table-scroll"
            style={{
              // Keep the queue area scrollable (do not expand when the right panel grows).
              // Tune this value if you want more/less items visible.
              maxHeight: 'min(420px, calc(100vh - 320px))',
              overflowY: 'auto',
              padding: 10,
            }}
          >
            {filteredRows.length === 0 && (
              <div style={{ color: '#64748b', fontWeight: 700, textAlign: 'center', padding: 20 }}>
                No shortages in this category.
              </div>
            )}
            {filteredRows.slice(0, 200).map((r, i) => {
              const selectedNow = selected?.part_number === r.part_number && selected?.shortage_type === r.shortage_type;
              const action = r.action_group;
              const colors =
                action === 'ACT_NOW'
                  ? { text: '#7f1d1d', bg: '#fef2f2', border: '#fecaca' }
                  : action === 'PLAN_THIS_WEEK'
                    ? { text: '#92400e', bg: '#fef3c7', border: '#fde68a' }
                    : { text: '#0369a1', bg: '#e0f2fe', border: '#bae6fd' };
              const days = Math.trunc(Number(r.days_until_shortage || 0));
              const daysTxt = days <= 0 ? `${Math.abs(days)} days overdue` : `in ${days} days`;
              return (
                <button
                  key={`${r.part_number}-${r.shortage_type}-${i}`}
                  type="button"
                  onClick={() => generate(r)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                    marginBottom: 8,
                    padding: 12,
                    outline: selectedNow ? '2px solid #2563eb' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 900, color: colors.text }}>{r.part_number}</span>
                      <span
                        style={{
                          marginLeft: 6,
                          display: 'inline-block',
                          background: r.shortage_type === 'CURRENT' ? '#dbeafe' : '#f3e8ff',
                          color: r.shortage_type === 'CURRENT' ? '#1e40af' : '#7c3aed',
                          borderRadius: 999,
                          fontSize: 9,
                          fontWeight: 800,
                          padding: '2px 6px',
                        }}
                      >
                        {r.shortage_type}
                      </span>
                    </div>
                    <span
                      style={{
                        background: colors.border,
                        color: colors.text,
                        fontSize: 10,
                        fontWeight: 800,
                        borderRadius: 999,
                        padding: '2px 8px',
                      }}
                    >
                      {actionLabel(r.action_group)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.text, marginBottom: 4 }}>Short {daysTxt}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    Qty: {Math.trunc(Number(r.shortage_qty || 0)).toLocaleString()} | Impact: $
                    {Math.trunc(Number(r.business_impact_score || 0)).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {Math.trunc(Number(r.affected_wo_count || 0)) > 0 ? `${Math.trunc(Number(r.affected_wo_count || 0))} WOs blocked` : 'Predicted shortage'} |{' '}
                    {String(r.affected_products || 'N/A').slice(0, 28)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 10 }}>AI Resolution Center</div>
          {!selected && (
            <div style={{ color: '#94a3b8', fontWeight: 700, textAlign: 'center', padding: 40 }}>
              Select a part in the queue to generate an AI recommendation.
            </div>
          )}
          {selected && (
            <>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Selected Shortage</div>
                  <span
                    style={{
                      background: selected.shortage_type === 'CURRENT' ? '#dbeafe' : '#f3e8ff',
                      color: selected.shortage_type === 'CURRENT' ? '#1e40af' : '#7c3aed',
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {selected.shortage_type}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                  <div><span style={{ color: '#64748b' }}>Part:</span> <strong>{selected.part_number}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Qty Short:</span> <strong>{Math.trunc(Number(selected.shortage_qty || 0)).toLocaleString()}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Days Until:</span> <strong>{Math.trunc(Number(selected.days_until_shortage || 0))} days</strong></div>
                  <div><span style={{ color: '#64748b' }}>Priority:</span> <strong>P{Math.trunc(Number(selected.highest_priority || 0)) || 1}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Plants:</span> <strong>{String(selected.affected_plants || 'N/A')}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Products:</span> <strong>{String(selected.affected_products || 'N/A')}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Action:</span> <strong>{actionLabel(selected.action_group)}</strong></div>
                  <div><span style={{ color: '#64748b' }}>Impact:</span> <strong>${Math.trunc(Number(selected.business_impact_score || 0)).toLocaleString()}</strong></div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 12,
                  fontSize: 13,
                  lineHeight: 1.7,
                  background: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: 10,
                  padding: 16,
                  minHeight: 180,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800, color: '#166534', marginBottom: 12 }}>AI RECOMMENDATION</div>
                <div dangerouslySetInnerHTML={{ __html: rec ? formatRecommendationHtml(rec) : (recLoading ? 'Generating AI recommendation...' : '—') }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
                <button
                  className="secondary"
                  type="button"
                  disabled={!selected || poLoading}
                  onClick={async () => {
                    if (!selected) return;
                    setPoPreviewLoading(true);
                    setPoMsg(null);
                    try {
                      const preview = (await aiApi.shortagePoPreview(selected)) || [];
                      const target = Math.trunc(Number(selected.shortage_qty || 0));
                      const total = preview.reduce((s, p) => s + Number(p.recommended_qty || 0), 0);
                      const adjusted = [...preview];
                      if (adjusted.length > 0 && target > 0 && total !== target) {
                        const diff = target - total;
                        adjusted[0] = {
                          ...adjusted[0],
                          recommended_qty: Math.max(1, Number(adjusted[0].recommended_qty || 0) + diff),
                        };
                      }
                      setPoPreview(adjusted);
                      setShowPoConfirm(true);
                    } catch (e: any) {
                      setPoMsg(e?.message ? String(e.message) : 'Failed to load PO preview');
                    } finally {
                      setPoPreviewLoading(false);
                    }
                  }}
                >
                  {poPreviewLoading ? 'Loading...' : 'Create PO'}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={!selected || emailLoading}
                  onClick={async () => {
                    if (!selected) return;
                    setEmailLoading(true);
                    setShowPoConfirm(false);
                    setPoMsg(null);
                    try {
                      const draft = await aiApi.shortageEmailDraft(selected);
                      setEmailDraft(draft);
                    } catch (e: any) {
                      setPoMsg(e?.message ? String(e.message) : 'Failed to load email draft');
                    } finally {
                      setEmailLoading(false);
                    }
                  }}
                >
                  {emailLoading ? 'Loading...' : 'Email Vendor'}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={!selected || resolveLoading}
                  onClick={async () => {
                    if (!selected) return;
                    setResolveLoading(true);
                    try {
                      const r = await aiApi.markShortageResolved(selected);
                      setPoMsg(r.message || (r.ok ? 'Marked as resolved' : 'Failed to mark resolved'));
                      if (r.ok) {
                        const q = await aiApi.shortageQueue();
                        const normalized = (Array.isArray(q) ? q : []).map(normalizeRow);
                        setRows(normalized);
                        setSelected(null);
                        setRec(null);
                        setEmailDraft(null);
                      }
                    } catch (e: any) {
                      setPoMsg(e?.message ? String(e.message) : 'Failed to mark resolved');
                    } finally {
                      setResolveLoading(false);
                    }
                  }}
                >
                  {resolveLoading ? 'Marking...' : 'Mark Resolved'}
                </button>
              </div>
              {showPoConfirm && (
                <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Confirm Purchase Order Details</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {(poPreview || []).map((p, idx) => (
                      <div key={`${p.supplier_id}-${idx}`} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{`PO #${idx + 1}: ${p.supplier_id}`}</div>
                        <div style={{ fontSize: 12, color: '#475569', marginTop: 4 }}>
                          Part: <strong>{selected.part_number}</strong><br />
                          Quantity: <strong>{Number(p.recommended_qty || 0).toLocaleString()} units</strong><br />
                          Plant: <strong>{p.plant_id}</strong><br />
                          Delivery: <strong>{p.delivery_date}</strong>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
                    Total PO Qty: {(poPreview || []).reduce((s, p) => s + Number(p.recommended_qty || 0), 0).toLocaleString()} units
                    {'  '}|{'  '}Selected Shortage Qty: {Math.trunc(Number(selected.shortage_qty || 0)).toLocaleString()} units
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                      className="primary"
                      type="button"
                      disabled={poLoading}
                      onClick={async () => {
                        if (!selected) return;
                        setPoLoading(true);
                        try {
                          setEmailDraft(null);
                          setIntegrationEvents([]);
                          let ok = 0;
                          const msgs: string[] = [];
                          for (const p of (poPreview || [])) {
                            const r = await aiApi.createShortagePo({
                              ...selected,
                              supplier_id: p.supplier_id,
                              shortage_qty: p.recommended_qty,
                              affected_plants: p.plant_id,
                            } as any);
                            msgs.push(r.message || (r.ok ? 'PO created' : 'Failed to create PO'));
                            if (r.ok) ok += 1;
                            addIntegrationEvent({
                              type: 'po',
                              title: r.ok ? 'Purchase Order Created' : 'Purchase Order Failed',
                              system: 'SAP S/4HANA',
                              status: r.ok ? 'SUCCESS' : 'FAILED',
                              referenceId: r.po_id || `SAP-PO-${new Date().getTime().toString().slice(-6)}`,
                              details: `${selected.part_number} | Supplier ${p.supplier_id} | Qty ${Number(p.recommended_qty || 0).toLocaleString()} | Plant ${p.plant_id}`,
                            }, ok === 0 && msgs.length === 1);
                          }
                          setPoMsg(ok > 0 ? `Created ${ok} PO(s). ${msgs.join(' | ')}` : msgs.join(' | '));
                          if (ok > 0) setShowPoConfirm(false);
                        } catch (e: any) {
                          setPoMsg(e?.message ? String(e.message) : 'Failed to create PO(s)');
                        } finally {
                          setPoLoading(false);
                        }
                      }}
                    >
                      {poLoading ? 'Creating...' : 'Confirm & Create PO(s)'}
                    </button>
                    <button className="secondary" type="button" onClick={() => setShowPoConfirm(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {poMsg && (
                <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: poMsg.toLowerCase().includes('fail') ? '#b91c1c' : '#166534' }}>
                  {poMsg}
                </div>
              )}
              {emailDraft && (
                <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>Draft Email to Vendor</div>
                  <input value={emailDraft.to} readOnly style={{ width: '100%', marginBottom: 6, padding: 8, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <input value={emailDraft.subject} readOnly style={{ width: '100%', marginBottom: 6, padding: 8, borderRadius: 8, border: '1px solid #e5e7eb' }} />
                  <textarea value={emailDraft.body} readOnly rows={10} style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid #e5e7eb', resize: 'vertical' }} />
                  <button
                    className="primary"
                    type="button"
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`To: ${emailDraft.to}\nSubject: ${emailDraft.subject}\n\n${emailDraft.body}`);
                        setPoMsg('Email draft copied to clipboard');
                      } catch {
                        setPoMsg('Unable to copy automatically. Please copy manually.');
                      }
                    }}
                  >
                    Copy to Clipboard
                  </button>
                  <button
                    className="primary"
                    type="button"
                    style={{ marginTop: 8, marginLeft: 8 }}
                    onClick={() => {
                      const vendorEmailId = `COUPA-MSG-${new Date().getTime().toString().slice(-6)}`;
                      setShowPoConfirm(false);
                      setPoPreview([]);
                      setEmailDraft(null);
                      addIntegrationEvent({
                        type: 'email',
                        title: 'Vendor Email Sent',
                        system: 'Coupa Supplier Portal',
                        status: 'SUCCESS',
                        referenceId: vendorEmailId,
                        details: `Sent to ${emailDraft.to} for part ${selected?.part_number || 'N/A'}`,
                      }, true);
                      setPoMsg(`Email sent to vendor. Message ID: ${vendorEmailId}`);
                    }}
                  >
                    Send Email
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    style={{ marginTop: 8, marginLeft: 8 }}
                    onClick={() => setEmailDraft(null)}
                  >
                    Close
                  </button>
                </div>
              )}
              {integrationEvents.length > 0 && (
                <div style={{ marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
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
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
