import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ctbApi } from '../api/ctbApi';
import type { BomLineageRow, BomNode, BomOpenPoRow, BomStats, BomWhereUsedRow, FilterOptions, WorkOrder } from '../types/ctb';

export default function BomExplorerStreamlitParity() {
  const [params] = useSearchParams();

  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const productFromUrl = params.get('product') || '';
  const woFromUrl = params.get('wo') || '';
  const constraintFromUrl = params.get('constraint') || '';
  // Initialize from URL immediately, so we don't show a blank filter-only state.
  const [selectedProduct, setSelectedProduct] = useState<string>(() => productFromUrl);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [selectedWoId, setSelectedWoId] = useState<string>(() => woFromUrl); // '' = All Work Orders

  const [bom, setBom] = useState<BomNode[]>([]);
  const [bomStats, setBomStats] = useState<BomStats | null>(null);
  const [lineageRows, setLineageRows] = useState<BomLineageRow[]>([]);
  const [loadingLineage, setLoadingLineage] = useState(false);
  const [constraintParts, setConstraintParts] = useState<string[]>([]);
  const [constraintPart, setConstraintPart] = useState<string>(() => constraintFromUrl); // '' = none

  const [tab, setTab] = useState<'explosion' | 'where'>('explosion');

  const [loadingBom, setLoadingBom] = useState(false);
  const [loadingWo, setLoadingWo] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const loadingLineageTimerRef = useRef<number | null>(null);
  const loadingBomTimerRef = useRef<number | null>(null);
  const loadingWoTimerRef = useRef<number | null>(null);
  const [whereUsedRows, setWhereUsedRows] = useState<BomWhereUsedRow[]>([]);
  const [loadingWhereUsed, setLoadingWhereUsed] = useState(false);
  const [openPosRows, setOpenPosRows] = useState<BomOpenPoRow[]>([]);
  const [loadingOpenPos, setLoadingOpenPos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levelColor = (l: number) => {
    const colors = ['#1e40af', '#7c3aed', '#0d9488', '#b45309', '#be123c'];
    return colors[Math.min(l - 1, colors.length - 1)];
  };

  const maxLevel = bom.length ? Math.max(...bom.map((b) => Number(b.BOM_LEVEL || 0))) : 0;
  const uniqueParents = bom.length ? new Set(bom.map((b) => b.PARENT_PART_NUMBER)).size : 0;
  const uniqueChildren = bom.length ? new Set(bom.map((b) => b.CHILD_PART_NUMBER)).size : 0;

  const partDescriptionMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of bom) {
      if (!m.has(n.CHILD_PART_NUMBER)) m.set(n.CHILD_PART_NUMBER, n.CHILD_PART_DESCRIPTION || '');
    }
    return m;
  }, [bom]);

  const selectedWo = useMemo(
    () => workOrders.find((w) => w.WORK_ORDER_ID === selectedWoId) || null,
    [workOrders, selectedWoId],
  );

  const whereUsedKpis = useMemo(() => {
    const productsCount = whereUsedRows.length;
    const totalWos = whereUsedRows.reduce((acc, r) => acc + (Number(r.WORK_ORDERS) || 0), 0);
    const maxQty = whereUsedRows.reduce((acc, r) => Math.max(acc, Number(r.QTY_PER_UNIT) || 0), 0);
    const totalGap = Math.max(0, whereUsedRows.reduce((acc, r) => acc + (Number(r.GAP) || 0), 0));
    return { productsCount, totalWos, maxQty, totalGap };
  }, [whereUsedRows]);

  const lineageDiagram = useMemo(() => {
    if (!lineageRows.length) return null;

    const safeConstraintUpper = (constraintPart || '').trim().toUpperCase();
    const maxLevel = Math.max(...lineageRows.map((r) => Number(r.LEVEL || 0)));

    // Preserve Streamlit ordering: LINEAGE rows are already ordered by (LEVEL, PARENT, CHILD).
    const parentChildren = new Map<string, string[]>();
    const parentChildSeen = new Map<string, Set<string>>();
    const levelChildren = new Map<number, string[]>();
    const levelChildSeen = new Map<number, Set<string>>();
    const nodeRowByKey = new Map<string, BomLineageRow>();

    for (const row of lineageRows) {
      const lvl = Number(row.LEVEL || 0);
      const parent = row.PARENT_PART_NUMBER;
      const child = row.CHILD_PART_NUMBER;

      if (!parentChildSeen.has(parent)) {
        parentChildSeen.set(parent, new Set());
        parentChildren.set(parent, []);
      }
      if (!parentChildSeen.get(parent)!.has(child)) {
        parentChildSeen.get(parent)!.add(child);
        parentChildren.get(parent)!.push(child);
      }

      if (!levelChildSeen.has(lvl)) {
        levelChildSeen.set(lvl, new Set());
        levelChildren.set(lvl, []);
      }
      if (!levelChildSeen.get(lvl)!.has(child)) {
        levelChildSeen.get(lvl)!.add(child);
        levelChildren.get(lvl)!.push(child);
      }

      const key = `${lvl}_${child}`;
      if (!nodeRowByKey.has(key)) nodeRowByKey.set(key, row);
    }

    const getOrderedParts = (level: number, parentOrder?: string[]) => {
      const base = levelChildren.get(level) || [];
      if (!parentOrder) return base;

      const baseSet = new Set(base);
      const ordered: string[] = [];

      for (const p of parentOrder) {
        const childList = parentChildren.get(p) || [];
        for (const c of childList) {
          if (baseSet.has(c) && !ordered.includes(c)) ordered.push(c);
        }
      }

      for (const c of base) {
        if (!ordered.includes(c)) ordered.push(c);
      }

      return ordered;
    };

    const orderedPartsByLevel = new Map<number, string[]>();
    orderedPartsByLevel.set(1, getOrderedParts(1));
    for (let level = 2; level <= maxLevel; level++) {
      orderedPartsByLevel.set(level, getOrderedParts(level, orderedPartsByLevel.get(level - 1) || []));
    }

    let maxPartsAtLevel = 0;
    for (let level = 1; level <= maxLevel; level++) {
      maxPartsAtLevel = Math.max(maxPartsAtLevel, (orderedPartsByLevel.get(level) || []).length);
    }

    // Use pixel coordinates to avoid SVG viewBox/y-axis scaling issues.
    const box_width = 240;
    const box_height = 80;
    const vertical_spacing = 120;
    const horizontal_spacing = 290;
    const paddingX = 20;
    const paddingY = 40;

    const canvasHeight = Math.max(520, maxPartsAtLevel * vertical_spacing + paddingY * 2);
    const canvasWidth = Math.max(820, (maxLevel + 1) * horizontal_spacing + box_width + paddingX);

    const chartHeight = canvasHeight;

    const root_x = paddingX + box_width / 2; // x-center
    const root_y = canvasHeight / 2; // y-center

    const nodePositions = new Map<string, { x: number; y: number }>();
    const boxes: Array<{
      key: string;
      x: number;
      y: number;
      fill: string;
      borderColor: string;
      borderWidth: number;
      textColor: string;
      partNumber: string;
      qty: number;
      effAvail: number;
      needQty: number;
    }> = [];

    for (let level = 1; level <= maxLevel; level++) {
      const orderedParts = orderedPartsByLevel.get(level) || [];
      const n_parts = orderedParts.length;
      const level_height = n_parts * vertical_spacing;
      const start_y = (canvasHeight - level_height) / 2 + vertical_spacing / 2; // y-center of first node

      for (let i = 0; i < n_parts; i++) {
        const part_num = orderedParts[i];
        const nodeKey = `L${level}_${part_num}`;

        const partRow = nodeRowByKey.get(`${level}_${part_num}`);
        if (!partRow) continue;

        const perAsm = Number(partRow.QTY_PER_ASSEMBLY || 0);
        const needQty = Number(partRow.BUILD_NEED_QTY ?? perAsm);
        const eff_avail = Number(partRow.EFF_AVAILABLE ?? partRow.QTY_AVAILABLE ?? 0);
        const safety = Number(partRow.SAFETY_STOCK ?? 0);

        const is_constraint = Boolean(
          safeConstraintUpper && part_num.toUpperCase().includes(safeConstraintUpper),
        );
        const is_shortage = eff_avail < needQty;
        const is_using_safety = !is_shortage && eff_avail < safety;

        const fill_color = is_shortage ? '#fef2f2' : is_using_safety ? '#fef9c3' : '#f0fdf4';
        const text_color = is_shortage ? '#dc2626' : is_using_safety ? '#854d0e' : '#166534';

        let border_color = '#22c55e';
        if (is_shortage) border_color = '#ef4444';
        else if (is_using_safety) border_color = '#fcd34d';

        let border_width = 2;
        if (is_constraint) {
          border_color = '#9333ea';
          border_width = 4;
        }

        const x_pos = paddingX + level * horizontal_spacing + box_width / 2; // x-center per level
        const y_pos = start_y + i * vertical_spacing;

        nodePositions.set(nodeKey, { x: x_pos, y: y_pos });

        boxes.push({
          key: nodeKey,
          x: x_pos,
          y: y_pos,
          fill: fill_color,
          borderColor: border_color,
          borderWidth: border_width,
          textColor: text_color,
          partNumber: part_num,
          qty: perAsm,
          effAvail: eff_avail,
          needQty,
        });
      }
    }

    const edges: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];

    // Root -> Level 1 edges
    for (const part of orderedPartsByLevel.get(1) || []) {
      const childKey = `L1_${part}`;
      const childPos = nodePositions.get(childKey);
      if (!childPos) continue;
      edges.push({
        // Draw outside box boundaries: root right edge -> child left edge
        x0: root_x + box_width / 2,
        y0: root_y,
        x1: childPos.x - box_width / 2,
        y1: childPos.y,
      });
    }

    // Parent -> Child edges
    for (const [parent_part, children] of parentChildren.entries()) {
      for (let level = 1; level < maxLevel; level++) {
        const parentKey = `L${level}_${parent_part}`;
        const parentPos = nodePositions.get(parentKey);
        if (!parentPos) continue;

        for (const child_pn of children) {
          const childKey = `L${level + 1}_${child_pn}`;
          const childPos = nodePositions.get(childKey);
          if (!childPos) continue;

          edges.push({
            // Parent right edge -> child left edge
            x0: parentPos.x + box_width / 2,
            y0: parentPos.y,
            x1: childPos.x - box_width / 2,
            y1: childPos.y,
          });
        }
      }
    }

    const viewBox = `0 0 ${canvasWidth} ${canvasHeight}`;

    return {
      maxLevel,
      canvasWidth,
      canvasHeight,
      chartHeight,
      viewBox,
      box_width,
      box_height,
      root_x,
      root_y,
      boxes,
      edges,
    };
  }, [lineageRows, constraintPart]);

  const loadFilterOptions = useCallback(async () => {
    setError(null);
    try {
      const data = await ctbApi.filters();
      setFilterOptions(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load filter options');
    }
  }, [params]);

  const loadWorkOrders = useCallback(async (product: string) => {
    setError(null);
    setLoadingWo(false);
    if (loadingWoTimerRef.current) window.clearTimeout(loadingWoTimerRef.current);
    loadingWoTimerRef.current = window.setTimeout(() => setLoadingWo(true), 200);
    try {
      const wo = await ctbApi.workOrders({ product });
      setWorkOrders(Array.isArray(wo) ? wo : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load work orders');
    } finally {
      if (loadingWoTimerRef.current) window.clearTimeout(loadingWoTimerRef.current);
      loadingWoTimerRef.current = null;
      setLoadingWo(false);
    }
  }, []);

  const loadBom = useCallback(async (product: string) => {
    setError(null);
    setLoadingBom(false);
    if (loadingBomTimerRef.current) window.clearTimeout(loadingBomTimerRef.current);
    loadingBomTimerRef.current = window.setTimeout(() => setLoadingBom(true), 200);
    try {
      const data = await ctbApi.bom(product);
      setBom(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load BOM');
    } finally {
      if (loadingBomTimerRef.current) window.clearTimeout(loadingBomTimerRef.current);
      loadingBomTimerRef.current = null;
      setLoadingBom(false);
    }
  }, []);

  const loadBomStats = useCallback(async (product: string, woId?: string) => {
    if (!product) return;
    setBomStats(null);
    setError(null);
    try {
      setLoadingStats(true);
      const stats = await ctbApi.bomStats(product, woId);
      setBomStats(stats && typeof stats === 'object' ? stats : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load BOM KPIs');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadLineage = useCallback(async (product: string, woId?: string) => {
    if (!product) return;
    setError(null);
    setLoadingLineage(false);
    setLineageRows([]);
    if (loadingLineageTimerRef.current) window.clearTimeout(loadingLineageTimerRef.current);
    loadingLineageTimerRef.current = window.setTimeout(() => setLoadingLineage(true), 200);

    try {
      const data = await ctbApi.bomLineage(product, woId);
      setLineageRows(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load BOM lineage');
    } finally {
      if (loadingLineageTimerRef.current) window.clearTimeout(loadingLineageTimerRef.current);
      loadingLineageTimerRef.current = null;
      setLoadingLineage(false);
    }
  }, []);

  const loadWhereUsed = useCallback(async (part: string) => {
    if (!part) return;
    setError(null);
    setLoadingWhereUsed(false);
    setWhereUsedRows([]);
    setOpenPosRows([]);

    try {
      setLoadingWhereUsed(true);
      const rows = await ctbApi.bomWhereUsed(part);
      setWhereUsedRows(Array.isArray(rows) ? rows : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load where-used');
    } finally {
      setLoadingWhereUsed(false);
    }
  }, []);

  const loadOpenPos = useCallback(async (part: string) => {
    if (!part) return;
    setError(null);
    setLoadingOpenPos(false);
    setOpenPosRows([]);
    try {
      setLoadingOpenPos(true);
      const rows = await ctbApi.bomOpenPos(part);
      setOpenPosRows(Array.isArray(rows) ? rows : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load open POs');
    } finally {
      setLoadingOpenPos(false);
    }
  }, []);

  useEffect(() => {
    loadFilterOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Keep in sync if user navigates to a different product without remounting.
    if (productFromUrl !== selectedProduct) setSelectedProduct(productFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFromUrl]);

  useEffect(() => {
    if (!selectedProduct) return;

    // When navigating from dashboard, keep WO + constraint from URL (if present).
    // Otherwise default to "All Work Orders" / empty constraint.
    setSelectedWoId(woFromUrl || '');
    setConstraintPart(constraintFromUrl || '');
    setTab('explosion');

    loadWorkOrders(selectedProduct);
    loadBom(selectedProduct);
  }, [selectedProduct, woFromUrl, constraintFromUrl, loadWorkOrders, loadBom]);

  useEffect(() => {
    if (!selectedProduct) return;
    loadBomStats(selectedProduct, selectedWoId || undefined);
    loadLineage(selectedProduct, selectedWoId || undefined);
  }, [selectedProduct, selectedWoId, loadBomStats, loadLineage]);

  useEffect(() => {
    if (!bom.length) {
      setConstraintParts([]);
      if (!constraintFromUrl) setConstraintPart('');
      return;
    }

    const parts = Array.from(new Set(bom.map((b) => b.CHILD_PART_NUMBER))).sort();
    const urlC = (constraintFromUrl || '').trim();

    if (urlC) {
      const merged = (parts.includes(urlC) ? parts : [urlC, ...parts]).sort();
      setConstraintParts(merged);
      setConstraintPart(urlC);
      return;
    }

    setConstraintParts(parts);
    setConstraintPart((prev) => (prev && parts.includes(prev) ? prev : parts[0] || ''));
  }, [bom, constraintFromUrl]);

  useEffect(() => {
    // If URL requested a specific WO but it isn't present in the loaded list, fall back.
    // Important: do NOT clear while work orders are still loading (workOrders starts as []).
    if (!selectedWoId) return;
    if (loadingWo) return;
    if (workOrders.length === 0) return;

    const exists = workOrders.some((w) => w.WORK_ORDER_ID === selectedWoId);
    if (!exists) setSelectedWoId('');
  }, [workOrders, selectedWoId, loadingWo]);

  useEffect(() => {
    if (tab !== 'where') return;
    if (!constraintPart) {
      setWhereUsedRows([]);
      setOpenPosRows([]);
      return;
    }
    loadWhereUsed(constraintPart);
    loadOpenPos(constraintPart);
  }, [tab, constraintPart, loadWhereUsed, loadOpenPos]);

  const reset = useCallback(() => {
    setSelectedProduct('');
    setWorkOrders([]);
    setSelectedWoId('');
    setBom([]);
    setConstraintParts([]);
    setConstraintPart('');
    setLineageRows([]);
    setWhereUsedRows([]);
    setOpenPosRows([]);
    setTab('explosion');
    setError(null);
  }, []);

  const productOptions = useMemo(() => {
    const base = filterOptions?.products || [];
    if (!selectedProduct) return base;
    if (base.includes(selectedProduct)) return base;
    // Ensure the current URL-selected product is visible even if it isn't in returned filter options.
    return [selectedProduct, ...base];
  }, [filterOptions, selectedProduct]);

  return (
    <div>
      <div className="page-hero">
        <div className="page-hero-title">BOM Explosion Analysis</div>
        <div className="page-hero-subtitle">
          Explore lineage, constraints, where-used impact, and open PO coverage for selected BOM parts.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 2fr 2fr 1fr',
          gap: 12,
          alignItems: 'end',
          marginBottom: 18,
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 6 }}>Select Product</div>
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="" disabled>
              Select a product...
            </option>
            {productOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 6 }}>Select Work Order</div>
          <select value={selectedWoId} onChange={(e) => setSelectedWoId(e.target.value)} style={{ width: '100%' }}>
            <option value="">All Work Orders</option>
            {workOrders.map((wo) => (
              <option key={wo.WORK_ORDER_ID} value={wo.WORK_ORDER_ID}>
                {wo.WORK_ORDER_ID} - P{wo.PRIORITY}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', marginBottom: 6 }}>Select Part</div>
          <select value={constraintPart} onChange={(e) => setConstraintPart(e.target.value)} style={{ width: '100%' }}>
            <option value="">Select a part...</option>
            {constraintParts.map((pn) => (
              <option key={pn} value={pn}>
                {pn} - {(partDescriptionMap.get(pn) || '').slice(0, 25)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <button className="secondary" type="button" onClick={reset} style={{ width: '100%' }}>
            Reset
          </button>
        </div>
      </div>

      {loadingBom && <div className="loading">Loading BOM...</div>}
      {loadingWo && !loadingBom && <div className="loading">Loading Work Orders...</div>}
      {error && <div className="error-msg">{error}</div>}

      {/* If URL has product but BOM is still loading, keep the user informed. */}
      {selectedProduct && (loadingBom || loadingWo) && bom.length === 0 && !error && (
        <div className="loading">Loading BOM Explorer...</div>
      )}

      {bom.length > 0 && (
        <>
          {selectedWoId && selectedWo && (
            <div
              style={{
                background: '#dbeafe',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
                border: '1px solid #bfdbfe',
              }}
            >
              <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Work Order</span>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1e40af' }}>{selectedWo.WORK_ORDER_ID}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Priority</span>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#7c3aed' }}>P{selectedWo.PRIORITY}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Product</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{selectedProduct}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Plant</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{selectedWo.PLANT_ID}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: '#64748b' }}>Constraint</span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#dc2626' }}>{constraintPart || '—'}</div>
                </div>
              </div>
            </div>
          )}

          {tab === 'explosion' && (
            <div className="grid-4" style={{ marginBottom: 14 }}>
              <div className="kpi-card" style={{ background: '#dbeafe', borderColor: '#bfdbfe' }}>
                <div className="kpi-label" style={{ color: '#1e40af' }}>BOM LEVELS</div>
                <div className="kpi-value" style={{ fontSize: 28, color: '#1e3a8a' }}>
                  {loadingStats ? 'Loading...' : (bomStats?.max_depth ?? '—').toLocaleString()}
                </div>
              </div>
              <div className="kpi-card" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                <div className="kpi-label" style={{ color: '#166534' }}>TOTAL PARTS</div>
                <div className="kpi-value" style={{ fontSize: 28, color: '#14532d' }}>
                  {loadingStats ? 'Loading...' : (bomStats?.total_parts ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="kpi-card" style={{ background: '#f5f3ff', borderColor: '#ddd6fe' }}>
                <div className="kpi-label" style={{ color: '#6d28d9' }}>TOTAL QTY NEEDED</div>
                <div className="kpi-value" style={{ fontSize: 28, color: '#581c87' }}>
                  {loadingStats ? 'Loading...' : (bomStats?.total_qty_needed ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="kpi-card" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
                <div className="kpi-label" style={{ color: '#92400e' }}>LOW INVENTORY</div>
                <div className="kpi-value" style={{ fontSize: 28, color: '#78350f' }}>
                  {loadingStats ? 'Loading...' : (bomStats?.low_inv_cnt ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <button
              className={tab === 'explosion' ? 'primary' : 'secondary'}
              type="button"
              onClick={() => setTab('explosion')}
            >
              Product BOM Explosion
            </button>
            <button
              className={tab === 'where' ? 'primary' : 'secondary'}
              type="button"
              onClick={() => setTab('where')}
            >
              Part Where-Used
            </button>
          </div>

          <div className="card">
            {tab === 'explosion' && (
              <>
                <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                  Product BOM Explosion
                </h3>
                {loadingLineage && <div className="loading">Loading BOM Explosion...</div>}

                {!loadingLineage && (
                  <>
                    {lineageDiagram ? (
                      <>
                        <div style={{ width: '100%', overflowX: 'auto' }}>
                          <svg width="100%" height={lineageDiagram.canvasHeight} viewBox={lineageDiagram.viewBox}>
                            {/* Edges drawn before boxes so lines don't visually pass through cards. */}
                            {lineageDiagram.edges.map((e, idx) => (
                              <line
                                key={idx}
                                x1={e.x0}
                                y1={e.y0}
                                x2={e.x1}
                                y2={e.y1}
                                stroke="#94a3b8"
                                strokeWidth={2}
                              />
                            ))}

                            {/* Root box */}
                            <rect
                              x={lineageDiagram.root_x - lineageDiagram.box_width / 2}
                              y={lineageDiagram.root_y - lineageDiagram.box_height / 2}
                              width={lineageDiagram.box_width}
                              height={lineageDiagram.box_height}
                              fill="#dbeafe"
                              stroke="#3b82f6"
                              strokeWidth={2}
                            />

                            {/* Root labels */}
                            <text
                              x={lineageDiagram.root_x}
                              y={lineageDiagram.root_y}
                              textAnchor="middle"
                              fontSize={12}
                              fontWeight={800}
                              fill="#1e3a8a"
                              dominantBaseline="middle"
                            >
                              {selectedProduct.slice(0, 20)}
                            </text>
                            <text
                              x={lineageDiagram.root_x}
                              y={lineageDiagram.root_y - 26}
                              textAnchor="middle"
                              fontSize={10}
                              fontWeight={700}
                              fill="#64748b"
                              dominantBaseline="middle"
                            >
                              Root Product
                            </text>

                            {/* Nodes */}
                            {lineageDiagram.boxes.map((b) => (
                              <g key={b.key}>
                                <rect
                                  x={b.x - lineageDiagram.box_width / 2}
                                  y={b.y - lineageDiagram.box_height / 2}
                                  width={lineageDiagram.box_width}
                                  height={lineageDiagram.box_height}
                                  fill={b.fill}
                                  stroke={b.borderColor}
                                  strokeWidth={b.borderWidth}
                                />
                                <text
                                  x={b.x}
                                  y={b.y - 6}
                                  textAnchor="middle"
                                  fontSize={11}
                                  fontWeight={800}
                                  fill={b.textColor}
                                  dominantBaseline="middle"
                                >
                                  {b.partNumber.slice(0, 20)}
                                </text>
                                <text
                                  x={b.x}
                                  y={b.y + 16}
                                  textAnchor="middle"
                                  fontSize={10}
                                  fontWeight={700}
                                  fill="#64748b"
                                  dominantBaseline="middle"
                                >
                                  {`Need: ${b.needQty.toLocaleString()} | Eff Avail: ${b.effAvail.toLocaleString()}`}
                                </text>
                              </g>
                            ))}
                          </svg>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            gap: 20,
                            justifyContent: 'center',
                            marginTop: 16,
                            fontSize: 12,
                          }}
                        >
                          <span>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 16,
                                height: 16,
                                background: '#f0fdf4',
                                border: '2px solid #22c55e',
                                borderRadius: 4,
                                marginRight: 6,
                                verticalAlign: 'middle',
                              }}
                            />
                            OK
                          </span>
                          <span>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 16,
                                height: 16,
                                background: '#fef9c3',
                                border: '2px solid #fcd34d',
                                borderRadius: 4,
                                marginRight: 6,
                                verticalAlign: 'middle',
                              }}
                            />
                            Using Safety Stock
                          </span>
                          <span>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 16,
                                height: 16,
                                background: '#fef2f2',
                                border: '2px solid #ef4444',
                                borderRadius: 4,
                                marginRight: 6,
                                verticalAlign: 'middle',
                              }}
                            />
                            Shortage/Constraint
                          </span>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: '#64748b', fontWeight: 700, textAlign: 'center', padding: 20 }}>
                        No BOM data found for this product.
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {tab === 'where' && (
              <>
                <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                  Part Where-Used
                </h3>

                {!constraintPart ? (
                  <div style={{ color: '#64748b', fontWeight: 700, textAlign: 'center', padding: 20 }}>
                    Select a part from the dropdown above to see where it's used.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        background: '#fff7ed',
                        border: '1px solid #fed7aa',
                        borderRadius: 12,
                        padding: 16,
                        marginBottom: 16,
                      }}
                    >
                      <div style={{ fontSize: 11, color: '#9a3412', fontWeight: 600 }}>PART WHERE USED</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: '#7c2d12' }}>{constraintPart}</div>
                      <div style={{ fontSize: 12, color: '#9a3412', marginTop: 4 }}>All products that use this part</div>
                    </div>

                    <div className="grid-4" style={{ marginBottom: 16 }}>
                      <div className="kpi-card" style={{ background: '#dbeafe', borderColor: '#bfdbfe' }}>
                        <div className="kpi-label" style={{ color: '#1e40af' }}>PRODUCTS COUNT</div>
                        <div className="kpi-value" style={{ fontSize: 28, color: '#1e3a8a' }}>
                          {loadingWhereUsed ? 'Loading...' : whereUsedKpis.productsCount}
                        </div>
                      </div>
                      <div className="kpi-card" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
                        <div className="kpi-label" style={{ color: '#92400e' }}>WORK ORDERS</div>
                        <div className="kpi-value" style={{ fontSize: 28, color: '#78350f' }}>
                          {loadingWhereUsed ? 'Loading...' : whereUsedKpis.totalWos}
                        </div>
                      </div>
                      <div className="kpi-card" style={{ background: '#dcfce7', borderColor: '#bbf7d0' }}>
                        <div className="kpi-label" style={{ color: '#166534' }}>MAX QTY</div>
                        <div className="kpi-value" style={{ fontSize: 28, color: '#14532d' }}>
                          {loadingWhereUsed ? 'Loading...' : whereUsedKpis.maxQty.toLocaleString()}
                        </div>
                      </div>
                      <div className="kpi-card" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
                        <div className="kpi-label" style={{ color: '#dc2626' }}>TOTAL GAP</div>
                        <div className="kpi-value" style={{ fontSize: 28, color: '#b91c1c' }}>
                          {loadingWhereUsed ? 'Loading...' : whereUsedKpis.totalGap.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Products Affected</div>

                    {loadingWhereUsed ? (
                      <div className="loading">Loading where-used data...</div>
                    ) : whereUsedRows.length === 0 ? (
                      <div style={{ color: '#64748b', fontWeight: 700, textAlign: 'center', padding: 20 }}>
                        No products found using part '{constraintPart}'
                      </div>
                    ) : (
                      <div className="table-scroll" style={{ marginBottom: 16 }}>
                        <table>
                          <thead>
                            <tr>
                              <th>PRODUCT</th>
                              <th>BOM LEVEL</th>
                              <th>QTY PER UNIT</th>
                              <th>WORK ORDERS</th>
                              <th>TOTAL REQUIRED</th>
                              <th>AVAILABLE</th>
                              <th>GAP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {whereUsedRows.map((r, idx) => (
                              <tr
                                key={`${r.PRODUCT}-${r.BOM_LEVEL}-${idx}`}
                                style={{ backgroundColor: Number(r.GAP) > 0 ? '#fef2f2' : undefined }}
                              >
                                <td style={{ fontWeight: 800 }}>{r.PRODUCT}</td>
                                <td>{r.BOM_LEVEL}</td>
                                <td>{Number(r.QTY_PER_UNIT).toLocaleString()}</td>
                                <td>{Number(r.WORK_ORDERS).toLocaleString()}</td>
                                <td>{Number(r.TOTAL_REQUIRED).toLocaleString()}</td>
                                <td>{Number(r.AVAILABLE).toLocaleString()}</td>
                                <td style={{ fontWeight: 800, color: Number(r.GAP) > 0 ? '#dc2626' : '#111827' }}>
                                  {Number(r.GAP).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Open POs for this Part</div>

                    {loadingOpenPos ? (
                      <div className="loading">Loading open POs...</div>
                    ) : openPosRows.length === 0 ? (
                      <div style={{ color: '#b45309', fontWeight: 700, background: '#fffbeb', border: '1px solid #fef08a', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                        No open POs found for this part. Consider creating a procurement order.
                      </div>
                    ) : (
                      <>
                        <div className="table-scroll" style={{ marginBottom: 10 }}>
                          <table>
                            <thead>
                              <tr>
                                <th>PO_ID</th>
                                <th>SUPPLIER</th>
                                <th>QTY_ORDERED</th>
                                <th>QTY_OUTSTANDING</th>
                                <th>CONFIRMED_DELIVERY_DATE</th>
                                <th>PO_STATUS</th>
                              </tr>
                            </thead>
                            <tbody>
                              {openPosRows.map((p) => (
                                <tr key={p.PO_ID}>
                                  <td style={{ fontWeight: 800 }}>{p.PO_ID}</td>
                                  <td>{p.SUPPLIER}</td>
                                  <td>{Number(p.QTY_ORDERED).toLocaleString()}</td>
                                  <td style={{ fontWeight: 800 }}>{Number(p.QTY_OUTSTANDING).toLocaleString()}</td>
                                  <td>{p.CONFIRMED_DELIVERY_DATE}</td>
                                  <td>{p.PO_STATUS}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div style={{ color: '#166534', fontWeight: 800, textAlign: 'center', marginTop: 6 }}>
                          Total incoming from POs:{' '}
                          {openPosRows.reduce((acc, r) => acc + (Number(r.QTY_OUTSTANDING) || 0), 0).toLocaleString()} units
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

