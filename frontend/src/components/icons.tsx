const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

export const CalendarIcon = () => (
  <svg {...base}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
)
export const PinIcon = () => (
  <svg {...base}><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z" /><circle cx="12" cy="9" r="2.5" /></svg>
)
export const CheckCircleIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
)
export const WarningIcon = () => (
  <svg {...base}><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></svg>
)
export const SearchIcon = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
export const BanIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></svg>
)
