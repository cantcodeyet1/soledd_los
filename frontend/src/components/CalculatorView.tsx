import { useState } from 'react';
import { requestJson } from '../services/api';
import { CalculatorResult as CalculatorResultType, LoanProduct, BorrowerType, LOAN_PRODUCT_LABELS } from '../types';
import CalculatorResult, { AmortisationTable, CalculatorResultSkeleton } from './CalculatorResult';
import Dropdown from './Dropdown';

const BORROWER_TYPES: { key: BorrowerType; label: string }[] = [
  { key: 'SALARIED', label: 'Salaried' },
  { key: 'NON_SALARIED', label: 'Non-Salaried' },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function CalculatorView() {
  const [product, setProduct] = useState<LoanProduct>('SSB');
  const [borrowerType, setBorrowerType] = useState<BorrowerType>('SALARIED');
  const [amount, setAmount] = useState(1000);
  const [disbursementDate, setDisbursementDate] = useState(todayIso());
  const [tenor, setTenor] = useState(6);
  const [result, setResult] = useState<CalculatorResultType | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compute() {
    setComputing(true);
    setError(null);
    try {
      const r = await requestJson('/calculator/compute', {
        method: 'POST',
        body: JSON.stringify({ product, borrowerType, amountRequired: amount, disbursementDate, tenorMonths: tenor }),
      });
      setResult(r);
    } catch (e: any) {
      setError(e.message || 'Failed to compute');
    } finally {
      setComputing(false);
    }
  }

  return (
    <div>
      <div className="mb-8 sm:mb-10">
        <div className="text-xs font-bold text-accent uppercase tracking-wide mb-2.5">Loan Calculator</div>
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">Quote a Loan</h1>
        <div className="text-sm text-text-dim mt-2">Ad-hoc quoting. For a live application, use the calculator on that application's detail view instead</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="border border-rule rounded-2xl p-6 bg-paper">
          <FieldRow label="Product">
            <Dropdown
              value={product}
              onChange={setProduct}
              options={Object.entries(LOAN_PRODUCT_LABELS).map(([k, v]) => ({ value: k as LoanProduct, label: v }))}
            />
          </FieldRow>

          <FieldRow label="Borrower Type">
            <div className="grid grid-cols-2 gap-2">
              {BORROWER_TYPES.map(b => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => setBorrowerType(b.key)}
                  className={`text-sm font-semibold px-3 py-2.5 rounded-lg border transition-colors ${borrowerType === b.key ? 'bg-solid text-white border-solid' : 'border-rule text-ink hover:border-ink'}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label="Amount Required (USD)">
            <input type="number" value={amount} min={50} step={50} onChange={e => setAmount(Number(e.target.value))} className="w-full border border-rule rounded-lg px-3 py-2.5 text-sm bg-card" />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Disbursement Date">
              <input type="date" value={disbursementDate} onChange={e => setDisbursementDate(e.target.value)} className="w-full border border-rule rounded-lg px-3 py-2.5 text-sm bg-card" />
            </FieldRow>
            <FieldRow label="Tenor (Months)">
              <input type="number" value={tenor} min={1} max={36} onChange={e => setTenor(Number(e.target.value))} className="w-full border border-rule rounded-lg px-3 py-2.5 text-sm bg-card" />
            </FieldRow>
          </div>

          <button onClick={compute} disabled={computing} className="bg-accent hover:bg-accent-deep text-white text-sm font-semibold px-5 py-2.5 rounded-lg mt-2 w-full sm:w-auto disabled:opacity-60">
            {computing ? 'Calculating…' : 'Calculate Instalment'}
          </button>
          {error && <div className="text-xs text-accent mt-2">{error}</div>}
        </div>

        <div className="border border-rule rounded-2xl p-6 bg-paper">
          {computing && <CalculatorResultSkeleton />}
          {!computing && !result && <div className="text-text-dim text-sm text-center py-10">Run a calculation to see results</div>}
          {!computing && result && <CalculatorResult result={result} />}
        </div>
      </div>

      {result && <AmortisationTable result={result} />}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="block text-[11px] uppercase tracking-wide text-text-dim mb-1.5">{label}</label>
      {children}
    </div>
  );
}
