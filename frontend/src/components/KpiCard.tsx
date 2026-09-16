interface Props {
  label: string;
  value: number | string;
  bg: string;
}

export default function KpiCard({ label, value, bg }: Props) {
  return (
    <div className="kpi-card" style={{ background: bg }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
