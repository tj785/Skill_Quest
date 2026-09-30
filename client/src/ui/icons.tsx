export function Trophy({ size = 22, locked = false }: { size?: number; locked?: boolean }) {
  const c = locked ? '#8f887a' : '#b36b00';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10v4a5 5 0 0 1-10 0V3z" fill={locked ? '#bdb6a8' : '#ffd166'} stroke={c} strokeWidth="1.5" />
      <path d="M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4" fill="none" stroke={c} strokeWidth="1.5" />
      <path d="M12 12v4M8 20h8l-1-4H9z" fill={locked ? '#bdb6a8' : '#ffd166'} stroke={c} strokeWidth="1.5" />
    </svg>
  );
}
