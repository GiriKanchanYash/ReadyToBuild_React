import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ctbApi } from '../api/ctbApi';
import type { BomNode } from '../types/ctb';

export default function BomExplorer() {
  const [params] = useSearchParams();
  const [productId, setProductId] = useState('');
  const [search, setSearch] = useState('');
  const [bom, setBom] = useState<BomNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!search) return;
    setLoading(true);
    setError(null);
    try {
      const data = await ctbApi.bom(search);
      setBom(data);
      setProductId(search);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load BOM');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const p = params.get('product');
    if (p && p !== search) {
      setSearch(p);
    }
  }, [params]);

  useEffect(() => {
    const p = params.get('product');
    if (p && p === search) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, params]);

  const levelColor = (l: number) => {
    const colors = ['#1e40af', '#7c3aed', '#0d9488', '#b45309', '#be123c'];
    return colors[Math.min(l - 1, colors.length - 1)];
  };
  const maxLevel = bom.length ? Math.max(...bom.map((b) => Number(b.BOM_LEVEL || 0))) : 0;
  const uniqueParents = bom.length ? new Set(bom.map((b) => b.PARENT_PART_NUMBER)).size : 0;

  return (
    <div>
      <div className="page-hero">
        <div className="page-hero-title">BOM Explorer</div>
        <div className="page-hero-subtitle">
          Explode the bill of materials for any product and trace multi-level component hierarchy.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <input
          type="text"
          placeholder="Enter Product ID (e.g. PRD0001)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          style={{
            flex: 1, padding: '10px 14px', border: '1px solid #e5e7eb',
            borderRadius: 10, fontSize: 14, outline: 'none',
          }}
        />
        <button className="primary" onClick={load}>Explode BOM</button>
      </div>

      {loading && <div className="loading">Loading BOM...</div>}
      {error && <div className="error-msg">{error}</div>}

      {bom.length > 0 && (
        <div>
          <div className="grid-3" style={{ marginBottom: 14 }}>
            <div className="kpi-card" style={{ background: '#e0f2fe', borderColor: '#bae6fd' }}>
              <div className="kpi-label" style={{ color: '#0369a1' }}>PRODUCT</div>
              <div className="kpi-value" style={{ fontSize: 20, color: '#0c4a6e' }}>{productId}</div>
            </div>
            <div className="kpi-card" style={{ background: '#f3e8ff', borderColor: '#ddd6fe' }}>
              <div className="kpi-label" style={{ color: '#6d28d9' }}>TOTAL COMPONENTS</div>
              <div className="kpi-value" style={{ color: '#5b21b6' }}>{bom.length}</div>
            </div>
            <div className="kpi-card" style={{ background: '#fef3c7', borderColor: '#fde68a' }}>
              <div className="kpi-label" style={{ color: '#92400e' }}>DEPTH / PARENTS</div>
              <div className="kpi-value" style={{ color: '#78350f' }}>
                L{maxLevel} / {uniqueParents}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
              Multi-Level BOM Breakdown
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Level</th>
                    <th>Parent</th>
                    <th>Child Part</th>
                    <th>Description</th>
                    <th>Type</th>
                    <th>Qty/Assembly</th>
                    <th>Extended Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((n, i) => (
                    <tr key={i}>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '1px 8px',
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 800,
                            background: levelColor(n.BOM_LEVEL) + '20',
                            color: levelColor(n.BOM_LEVEL),
                          }}
                        >
                          L{n.BOM_LEVEL}
                        </span>
                      </td>
                      <td style={{ paddingLeft: (n.BOM_LEVEL - 1) * 16 }}>{n.PARENT_PART_NUMBER}</td>
                      <td style={{ fontWeight: 700 }}>{n.CHILD_PART_NUMBER}</td>
                      <td style={{ color: '#475569', fontSize: 12 }}>{n.CHILD_PART_DESCRIPTION}</td>
                      <td style={{ fontSize: 11 }}>{n.CHILD_PART_TYPE}</td>
                      <td>{n.QTY_PER_ASSEMBLY}</td>
                      <td style={{ fontWeight: 700 }}>{n.EXTENDED_QTY}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
