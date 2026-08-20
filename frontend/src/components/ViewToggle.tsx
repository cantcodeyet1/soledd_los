export type ViewMode = 'grid' | 'list';

export default function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="relative flex border border-rule rounded-full p-0.5 shrink-0 bg-card">
      <div
        className={`absolute top-0.5 bottom-0.5 w-8 rounded-full bg-solid transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${mode === 'list' ? 'translate-x-8' : 'translate-x-0'}`}
      />
      <button
        onClick={() => onChange('grid')}
        aria-label="Grid view"
        className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${mode === 'grid' ? 'text-white' : 'text-text-dim'}`}
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>
      </button>
      <button
        onClick={() => onChange('list')}
        aria-label="List view"
        className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-200 ${mode === 'list' ? 'text-white' : 'text-text-dim'}`}
      >
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 5.5h12M4 10h12M4 14.5h12"/></svg>
      </button>
    </div>
  );
}
