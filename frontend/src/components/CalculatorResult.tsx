import { CalculatorResult as CalculatorResultType } from '../types';

export default function CalculatorResult({ result }: { result: CalculatorResultType }) {
  return (
    <div className="flex flex-col gap-5">
      <ResultRow label="Total Monthly Instalment" value={`$${result.totalMonthlyInstalment.toFixed(2)}`} emphasis />
      <div className="grid grid-cols-2 gap-x-4">
        <ResultRow label="Instalment (excl. Collection Fee)" value={`$${result.instalmentExclCollectionFee.toFixed(2)}`} compact />
        <ResultRow label="Collection Fee" value={`$${result.collectionFee.toFixed(2)}`} compact />
        <ResultRow label="First Repayment Date" value={result.firstRepaymentDate} compact />
        <ResultRow label="Final Repayment Date" value={result.finalRepaymentDate} compact />
        <ResultRow label="Gross Loan Amount" value={`$${result.grossLoanAmount.toFixed(2)}`} compact />
        <ResultRow label="Monthly Rate" value={`${result.monthlyRatePct}%`} compact />
      </div>
      <div className="border-t border-rule pt-4">
        <div className="text-xs uppercase tracking-wide text-text-dim mb-3 font-semibold">Upfront Charges (capitalised into loan)</div>
        <div className="grid grid-cols-2 gap-x-4">
          <ResultRow label="IMMT" value={`$${result.upfrontCharges.immt.toFixed(2)}`} compact />
          <ResultRow label="Bank Charge" value={`$${result.upfrontCharges.bankCharge.toFixed(2)}`} compact />
          <ResultRow label="Establishment Fee" value={`$${result.upfrontCharges.establishment.toFixed(2)}`} compact />
          <ResultRow label="Loan Protection" value={`$${result.upfrontCharges.loanProtection.toFixed(2)}`} compact />
        </div>
      </div>
      <div className="border-t border-rule pt-4">
        <ResultRow label="Total Interest" value={`$${result.totalInterest.toFixed(2)}`} compact />
        <ResultRow label="Total Collection Fees" value={`$${result.totalCollectionFees.toFixed(2)}`} compact />
        <ResultRow label="Total Payable" value={`$${result.totalPayable.toFixed(2)}`} />
      </div>
    </div>
  );
}

function scheduleToCsv(result: CalculatorResultType): string {
  const header = ['#', 'Date', 'Opening', 'Interest', 'Principal', 'Instalment', 'Collection Fee', 'Total Instalment', 'Closing'];
  const rows = result.schedule.map(row => [
    row.no, row.date, row.opening, row.interest, row.principal,
    row.instalmentExclCollectionFee, row.collectionFee, row.totalInstalment, row.closing,
  ]);
  return [header, ...rows].map(r => r.join(',')).join('\n');
}

function downloadCsv(result: CalculatorResultType) {
  const csv = scheduleToCsv(result);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${result.productLabel.replace(/\s+/g, '_')}_amortisation_${result.disbursementDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AmortisationTable({ result }: { result: CalculatorResultType }) {
  return (
    <div className="border border-rule rounded-2xl mt-5 overflow-hidden">
      <div className="p-4 border-b border-rule font-display font-bold bg-paper flex items-center justify-between">
        Amortisation Schedule
        <button
          onClick={() => downloadCsv(result)}
          className="flex items-center gap-1.5 text-xs font-semibold text-text-dim hover:text-accent-bright transition-colors border border-rule hover:border-accent-bright rounded-full px-3 py-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5M4 16h12"/></svg>
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-text-dim border-b border-rule">
              <th className="px-4 py-3">#</th><th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Opening</th><th className="px-4 py-3">Interest</th><th className="px-4 py-3">Principal</th>
              <th className="px-4 py-3">Instalment</th><th className="px-4 py-3">Collection Fee</th><th className="px-4 py-3">Total Instalment</th><th className="px-4 py-3">Closing</th>
            </tr>
          </thead>
          <tbody>
            {result.schedule.map(row => (
              <tr key={row.no} className="border-b border-rule last:border-0">
                <td className="px-4 py-2.5 font-mono-brand">{row.no}</td>
                <td className="px-4 py-2.5 font-mono-brand">{row.date}</td>
                <td className="px-4 py-2.5 font-mono-brand">${row.opening.toFixed(2)}</td>
                <td className="px-4 py-2.5 font-mono-brand">${row.interest.toFixed(2)}</td>
                <td className="px-4 py-2.5 font-mono-brand">${row.principal.toFixed(2)}</td>
                <td className="px-4 py-2.5 font-mono-brand">${row.instalmentExclCollectionFee.toFixed(2)}</td>
                <td className="px-4 py-2.5 font-mono-brand">${row.collectionFee.toFixed(2)}</td>
                <td className="px-4 py-2.5 font-mono-brand font-semibold">${row.totalInstalment.toFixed(2)}</td>
                <td className="px-4 py-2.5 font-mono-brand">${row.closing.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CalculatorResultSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="h-8 w-40 rounded skeleton animate-shimmer" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-4 rounded skeleton animate-shimmer" />)}
      </div>
      <div className="border-t border-rule pt-4">
        <div className="h-3 w-56 rounded skeleton animate-shimmer mb-3" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-4 rounded skeleton animate-shimmer" />)}
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, value, compact, emphasis }: { label: string; value: string; compact?: boolean; emphasis?: boolean }) {
  return (
    <div className={`flex justify-between items-baseline ${compact ? 'py-1.5' : 'border-b border-rule pb-3.5'}`}>
      <span className="text-xs uppercase tracking-wide text-text-dim">{label}</span>
      <span className={`font-display font-bold ${emphasis ? 'text-2xl' : compact ? 'text-sm' : 'text-xl'}`}>{value}</span>
    </div>
  );
}
