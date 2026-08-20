import { useEffect, useRef, useState } from 'react';

export default function Dropdown<T extends string>({ value, options, onChange, label, compact }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div className="relative" ref={ref}>
      {label && <label className="block text-[10.5px] text-text-dim mb-1">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 border rounded-lg font-medium bg-card transition-colors ${
          compact ? 'px-2.5 py-2 text-xs' : 'px-3 py-2.5 text-sm'
        } ${open ? 'border-accent-bright' : 'border-rule hover:border-ink'}`}
      >
        <span className="truncate">{selected?.label ?? '-'}</span>
        <svg
          width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className={`shrink-0 text-text-dim transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M5 7.5 10 12.5 15 7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 mt-1.5 bg-card border border-rule rounded-xl shadow-lg z-30 origin-top animate-modalIn overflow-hidden py-1">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
                o.value === value ? 'bg-solid text-white' : 'text-ink hover:bg-paper'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
