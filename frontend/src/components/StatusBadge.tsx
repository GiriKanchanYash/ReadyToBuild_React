interface Props {
  status: string;
}

export default function StatusBadge({ status }: Props) {
  const s = (status || '').toLowerCase();
  const cls =
    s === 'ready' ? 'ready' : s === 'partial' ? 'partial' : s === 'blocked' ? 'blocked' : '';
  return <span className={`status-badge ${cls}`}>{status}</span>;
}
