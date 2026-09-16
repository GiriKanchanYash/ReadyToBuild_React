import { useEffect, useState } from 'react';
import { ctbApi } from '../api/ctbApi';
import type { FilterOptions } from '../types/ctb';

interface Props {
  product: string;
  plant: string;
  week: string;
  onChange: (f: { product: string; plant: string; week: string }) => void;
  className?: string;
  compact?: boolean;
}

export default function FilterBar({ product, plant, week, onChange, className, compact }: Props) {
  const [opts, setOpts] = useState<FilterOptions>({ products: [], plants: [], weeks: [] });
  const normalizedPlants = opts.plants.map((p) =>
    typeof p === 'string'
      ? { id: p, name: p, label: p }
      : { id: p.id, name: p.name, label: p.name && p.name !== p.id ? `${p.id} - ${p.name}` : p.id },
  );

  const currentWeekStart = () => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  useEffect(() => {
    ctbApi.filters()
      .then((o) => {
        setOpts(o);
        const cw = currentWeekStart();
        const fallback = o.weeks.includes(cw) ? cw : (o.weeks[0] || '');

        // Ensure we always pick a valid week from the backend (avoid initial "All Weeks" fetch).
        const desiredWeek = (!week || !o.weeks.includes(week)) ? fallback : week;
        if (desiredWeek && desiredWeek !== week) {
          onChange({ product, plant, week: desiredWeek });
        }
      })
      .catch(() => {});
  }, [week, product, plant, onChange]);

  return (
    <div
      className={`filter-bar${compact ? ' filter-bar--compact' : ''}${className ? ` ${className}` : ''}`}
      style={{ display: 'flex', width: '100%', gap: 12 }}
    >
      <select
        value={product}
        onChange={(e) => onChange({ product: e.target.value, plant, week })}
        style={{ flexBasis: '40%', flexGrow: 1, minWidth: 0 }}
      >
        <option value="">All Products</option>
        {opts.products.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <select
        value={plant}
        onChange={(e) => onChange({ product, plant: e.target.value, week })}
        style={{ flexBasis: '40%', flexGrow: 1, minWidth: 0 }}
      >
        <option value="">All Plants</option>
        {normalizedPlants.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <select
        value={week}
        onChange={(e) => onChange({ product, plant, week: e.target.value })}
        style={{ flexBasis: '20%', flexGrow: 0, minWidth: 0 }}
      >
        <option value="">All Weeks</option>
        {opts.weeks.map((w) => (
          <option key={w} value={w}>{w}</option>
        ))}
      </select>
    </div>
  );
}
