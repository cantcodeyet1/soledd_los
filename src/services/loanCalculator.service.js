/**
 * loanCalculator.service.js — Soledd Team Loan Calculator, reverse-engineered
 * from the client's "Soledd Loan Calculator All Products4.xlsx" (supersedes
 * the earlier "Soledd_Simple_Team_Loan_Calculator_Setup_Hidden.xlsx" model —
 * rates, the interest method, and the collection-fee bug all changed between
 * the two). Every figure below is a direct transcription of that workbook's
 * live formulas (Calculator, Amortisation, Setup, SME Options and SME
 * Negotiated sheets), verified against its own cached worked example (SSB,
 * $1000, 5 months, salaried, disbursed 2026-08-28) and the SME Negotiated
 * sheet's own bullet-loan example — every output value matched exactly,
 * including float precision.
 *
 * Two things worth knowing if the client's sheet changes again:
 *  - The collection fee is GROSSED UP, not a flat percentage: fee =
 *    instalment * rate/(1-rate), so the collector's cut is `rate` of the
 *    TOTAL instalment (instalment + fee), not `rate` of the instalment
 *    alone. This was the source of the old workbook's 10.5%-vs-5% bug — this
 *    version's Setup!D column (5%) is now correctly wired into the formula.
 *  - Interest is a flat monthly rate on a fixed 30-day/monthly cycle (a
 *    standard closed-form annuity), not the actual-day discounting the
 *    previous workbook used — the sheet no longer varies interest by how
 *    many calendar days actually fall in a period.
 */

'use strict';

const settingsService = require('./settings.service');

const INTEREST_METHOD = {
  ANNUITY: 'ANNUITY',                   // flat monthly rate, standard reducing-balance amortisation
  STRAIGHT_LINE_30: 'STRAIGHT_LINE_30', // Farm Shop: flat interest on the original gross loan
};

// Governs how each period's repayment date is chained from the previous one
// (the very first date is always just the loan's own repaymentStartDate).
const DATE_RULE = {
  BORROWER_TYPE: 'BORROWER_TYPE',   // EOMONTH if Salaried, else EDATE
  ALWAYS_EDATE: 'ALWAYS_EDATE',     // SME products: monthly anniversary regardless of borrower type
  FIXED_30_DAYS: 'FIXED_30_DAYS',   // Farm Shop: +30 calendar days each period
};

const REPAYMENT_TYPE = {
  EQUAL_INSTALMENTS: 'EQUAL_INSTALMENTS',
  INTEREST_ONLY_PRINCIPAL_AT_END: 'INTEREST_ONLY_PRINCIPAL_AT_END', // SME Negotiated only
};

// SME Standard and SME Negotiated both skip IMMT, bank charge and loan
// protection fee — only the (negotiable, for SME Negotiated) establishment
// fee applies.
const SME_UPFRONT_OVERRIDE = { immtPct: 0, bankChargePct: 0, loanProtectionFeePct: 0 };

const DEFAULT_PRODUCTS = {
  STANDARD_USD:   { label: 'Standard USD', monthlyRatePct: 8, collectionFeeApplies: false, interestMethod: INTEREST_METHOD.ANNUITY, dateRule: DATE_RULE.BORROWER_TYPE },
  SSB:            { label: 'SSB', monthlyRatePct: 8, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.ANNUITY, dateRule: DATE_RULE.BORROWER_TYPE },
  PENSIONS:       { label: 'Pensions', monthlyRatePct: 8, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.ANNUITY, dateRule: DATE_RULE.BORROWER_TYPE },
  ZIG_LOAN_20:    { label: 'ZiG Loan 20%', monthlyRatePct: 20, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.ANNUITY, dateRule: DATE_RULE.BORROWER_TYPE },
  FARM_SHOP:      { label: 'Farm Shop', monthlyRatePct: 5, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.STRAIGHT_LINE_30, dateRule: DATE_RULE.FIXED_30_DAYS },
  SME_STANDARD:   { label: 'SME Standard', monthlyRatePct: 10, collectionFeeApplies: false, interestMethod: INTEREST_METHOD.ANNUITY, dateRule: DATE_RULE.ALWAYS_EDATE, upfrontOverride: SME_UPFRONT_OVERRIDE },
  SME_NEGOTIATED: { label: 'SME Negotiated', monthlyRatePct: 10, collectionFeeApplies: false, interestMethod: INTEREST_METHOD.ANNUITY, dateRule: DATE_RULE.ALWAYS_EDATE, upfrontOverride: SME_UPFRONT_OVERRIDE, negotiable: true },
};

// Shared across all products (only the bank charge branches for ZiG; SME
// products override immt/bankCharge/loanProtection to 0 — see above).
const DEFAULT_UPFRONT = {
  immtPct: 2,
  bankChargePct: 1,
  zigBankChargePct: 2,
  zigBankChargeMin: 100,
  establishmentFeePct: 5,
  loanProtectionFeePct: 2.5,
  collectionFeePct: 5,
};

const SETTINGS_KEY = 'loan_calculator_config';

async function getConfig() {
  const stored = await settingsService.getSetting(SETTINGS_KEY);
  if (stored && stored.products && stored.upfront) return stored;
  return { products: DEFAULT_PRODUCTS, upfront: DEFAULT_UPFRONT };
}

async function setConfig(config) {
  await settingsService.setSetting(SETTINGS_KEY, config);
}

// ─── Date helpers (Excel EOMONTH/EDATE, calendar-day-count safe) ───────────
// All dates are treated as UTC-midnight "calendar dates" throughout, so
// local timezone never shifts a date by a day.

function toUtcDate(input) {
  const d = input instanceof Date ? input : new Date(input);
  return new Date(Date.UTC(d.getUTCFullYear ? d.getUTCFullYear() : d.getFullYear(), d.getUTCMonth ? d.getUTCMonth() : d.getMonth(), d.getUTCDate ? d.getUTCDate() : d.getDate()));
}

/** Excel EOMONTH(date, months): last day of the month `months` after date's month. */
function eomonth(date, months) {
  const d = toUtcDate(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0));
}

/** Excel EDATE(date, months): same day-of-month, `months` later; clamps to month end. */
function edate(date, months) {
  const d = toUtcDate(date);
  const targetMonthLastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), targetMonthLastDay);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, day));
}

function addDays(date, days) {
  const d = toUtcDate(date);
  return new Date(d.getTime() + days * 86400000);
}

function isoDate(d) {
  return toUtcDate(d).toISOString().slice(0, 10);
}

/** Suggested default first-repayment date, offered as an editable pre-fill (matches the sheet's own defaults). */
function suggestRepaymentStartDate(dateRule, borrowerType, disbursementDate) {
  if (dateRule === DATE_RULE.ALWAYS_EDATE) return edate(disbursementDate, 1);
  if (dateRule === DATE_RULE.FIXED_30_DAYS) return addDays(disbursementDate, 30);
  return borrowerType === 'SALARIED' ? eomonth(disbursementDate, 1) : edate(disbursementDate, 1);
}

function nextRepaymentDate(dateRule, borrowerType, prevDate) {
  if (dateRule === DATE_RULE.ALWAYS_EDATE) return edate(prevDate, 1);
  if (dateRule === DATE_RULE.FIXED_30_DAYS) return addDays(prevDate, 30);
  return borrowerType === 'SALARIED' ? eomonth(prevDate, 1) : edate(prevDate, 1);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Core calculation ───────────────────────────────────────────────────────

function computeUpfrontCharges(productCode, amountRequired, upfront, cfg) {
  const override = cfg.upfrontOverride || {};
  const immtPct = override.immtPct ?? (cfg.negotiable && cfg.negotiatedImmtPct != null ? cfg.negotiatedImmtPct : upfront.immtPct);
  const bankChargePct = override.bankChargePct ?? upfront.bankChargePct;
  const establishmentFeePct = cfg.negotiable && cfg.negotiatedEstablishmentFeePct != null ? cfg.negotiatedEstablishmentFeePct : upfront.establishmentFeePct;
  const loanProtectionFeePct = override.loanProtectionFeePct ?? upfront.loanProtectionFeePct;

  const immt = amountRequired * (immtPct / 100);
  const bankCharge = override.bankChargePct !== undefined
    ? amountRequired * (bankChargePct / 100)
    : productCode === 'ZIG_LOAN_20'
      ? Math.max(amountRequired * (upfront.zigBankChargePct / 100), upfront.zigBankChargeMin)
      : amountRequired * (bankChargePct / 100);
  const establishment = amountRequired * (establishmentFeePct / 100);
  const loanProtection = amountRequired * (loanProtectionFeePct / 100);
  return {
    immt, bankCharge, establishment, loanProtection,
    total: immt + bankCharge + establishment + loanProtection,
  };
}

/**
 * @param product          one of the keys in config.products (e.g. 'FARM_SHOP')
 * @param borrowerType     'SALARIED' | 'NON_SALARIED'
 * @param amountRequired   cash amount the client wants (before upfront charges are capitalised)
 * @param disbursementDate Date | ISO string
 * @param repaymentStartDate Date | ISO string — first instalment's due date; defaults via suggestRepaymentStartDate if omitted
 * @param tenorMonths      number of instalments
 * @param config           { products, upfront } — from getConfig()
 * @param negotiatedRates  SME_NEGOTIATED only: { monthlyRatePct, immtPct, bankChargePct, establishmentFeePct } overriding that product's defaults for this quote
 * @param repaymentType    SME_NEGOTIATED only: 'EQUAL_INSTALMENTS' (default) | 'INTEREST_ONLY_PRINCIPAL_AT_END'
 */
function computeLoan({
  product, borrowerType, amountRequired, disbursementDate, repaymentStartDate, tenorMonths, config,
  negotiatedRates, repaymentType,
}) {
  const baseCfg = config.products[product];
  if (!baseCfg) throw new Error(`Unknown product: ${product}`);
  if (!(tenorMonths > 0)) throw new Error('tenorMonths must be > 0');

  const cfg = baseCfg.negotiable && negotiatedRates
    ? {
        ...baseCfg,
        monthlyRatePct: negotiatedRates.monthlyRatePct ?? baseCfg.monthlyRatePct,
        negotiatedImmtPct: negotiatedRates.immtPct,
        negotiatedEstablishmentFeePct: negotiatedRates.establishmentFeePct,
        upfrontOverride: { ...baseCfg.upfrontOverride, bankChargePct: negotiatedRates.bankChargePct ?? baseCfg.upfrontOverride.bankChargePct },
      }
    : baseCfg;

  const isBulletLoan = cfg.negotiable && repaymentType === REPAYMENT_TYPE.INTEREST_ONLY_PRINCIPAL_AT_END;

  const monthlyRate = cfg.monthlyRatePct / 100;
  const charges = computeUpfrontCharges(product, amountRequired, config.upfront, cfg);
  const grossLoan = amountRequired + charges.total;

  const startDate = repaymentStartDate || suggestRepaymentStartDate(cfg.dateRule, borrowerType, disbursementDate);

  const dates = [];
  for (let i = 0; i < tenorMonths; i++) {
    dates.push(i === 0 ? toUtcDate(startDate) : nextRepaymentDate(cfg.dateRule, borrowerType, dates[i - 1]));
  }

  // Equal instalment (before collection fee), solved once for the whole loan.
  // Not used period-to-period for the bullet-loan (interest-only) case.
  let instalmentExclCF;
  if (cfg.interestMethod === INTEREST_METHOD.STRAIGHT_LINE_30) {
    instalmentExclCF = (grossLoan + grossLoan * monthlyRate * tenorMonths) / tenorMonths;
  } else if (isBulletLoan) {
    instalmentExclCF = grossLoan * monthlyRate; // interest-only recurring instalment; final period pays off principal too
  } else if (monthlyRate === 0) {
    instalmentExclCF = grossLoan / tenorMonths;
  } else {
    instalmentExclCF = (grossLoan * monthlyRate) / (1 - (1 + monthlyRate) ** -tenorMonths);
  }

  const collectionFeeRate = config.upfront.collectionFeePct / 100;

  const schedule = [];
  let opening = grossLoan;
  let totalInterest = 0;
  let totalCollectionFees = 0;
  let totalPayable = 0;

  for (let i = 0; i < tenorMonths; i++) {
    let interest, instalment, principal, closing;

    if (cfg.interestMethod === INTEREST_METHOD.STRAIGHT_LINE_30) {
      interest = grossLoan * monthlyRate;
      instalment = instalmentExclCF;
      principal = instalment - interest;
      closing = Math.max(0, opening - principal);
    } else if (isBulletLoan) {
      interest = opening * monthlyRate;
      instalment = i < tenorMonths - 1 ? interest : opening + interest;
      principal = instalment - interest;
      closing = Math.max(0, opening + interest - instalment);
    } else {
      interest = opening * monthlyRate;
      instalment = Math.min(instalmentExclCF, opening + interest);
      principal = instalment - interest;
      closing = Math.max(0, opening + interest - instalment);
    }

    // Grossed up: the collector's cut is `rate` of the TOTAL instalment
    // (instalment + fee), not `rate` of the instalment alone.
    const collectionFee = cfg.collectionFeeApplies ? (instalment * collectionFeeRate) / (1 - collectionFeeRate) : 0;
    const totalInstalment = instalment + collectionFee;

    schedule.push({
      no: i + 1,
      date: isoDate(dates[i]),
      opening: round2(opening),
      interest: round2(interest),
      instalmentExclCollectionFee: round2(instalment),
      principal: round2(principal),
      collectionFee: round2(collectionFee),
      totalInstalment: round2(totalInstalment),
      closing: round2(closing),
    });

    totalInterest += interest;
    totalCollectionFees += collectionFee;
    totalPayable += totalInstalment;
    opening = closing;
  }

  const firstCollectionFee = schedule[0].collectionFee;

  return {
    product,
    productLabel: cfg.label,
    borrowerType,
    monthlyRatePct: cfg.monthlyRatePct,
    interestMethod: cfg.interestMethod,
    repaymentType: isBulletLoan ? REPAYMENT_TYPE.INTEREST_ONLY_PRINCIPAL_AT_END : REPAYMENT_TYPE.EQUAL_INSTALMENTS,
    amountRequired: round2(amountRequired),
    disbursementDate: isoDate(disbursementDate),
    tenorMonths,
    upfrontCharges: {
      immt: round2(charges.immt),
      bankCharge: round2(charges.bankCharge),
      establishment: round2(charges.establishment),
      loanProtection: round2(charges.loanProtection),
      total: round2(charges.total),
    },
    grossLoanAmount: round2(grossLoan),
    firstRepaymentDate: isoDate(dates[0]),
    finalRepaymentDate: isoDate(dates[dates.length - 1]),
    instalmentExclCollectionFee: round2(instalmentExclCF),
    collectionFee: firstCollectionFee,
    totalMonthlyInstalment: round2(instalmentExclCF + firstCollectionFee),
    totalInterest: round2(totalInterest),
    totalCollectionFees: round2(totalCollectionFees),
    totalPayable: round2(totalPayable),
    schedule,
  };
}

// Sensible starting points only, mirroring the dashboard's per-loan
// calculator panel — an application's `category` (SSB/GOVT_PENSIONER/SME/
// PRIVATE_SECTOR) doesn't determine product 1:1, so these are just what gets
// used when the officer hasn't picked product/borrowerType for that loan yet.
const DEFAULT_PRODUCT_FOR_CATEGORY = {
  SSB: 'SSB',
  GOVT_PENSIONER: 'PENSIONS',
  SME: 'SME_STANDARD',
  PRIVATE_SECTOR: 'STANDARD_USD',
};

const DEFAULT_BORROWER_TYPE_FOR_CATEGORY = {
  SSB: 'SALARIED',
  GOVT_PENSIONER: 'SALARIED',
  SME: 'NON_SALARIED',
  PRIVATE_SECTOR: 'SALARIED',
};

/** Computes the loan for an application row, using its own stored terms if set, else category defaults. */
async function computeForApplication(application) {
  const config = await getConfig();
  const product = application.loan_product || DEFAULT_PRODUCT_FOR_CATEGORY[application.category];
  const borrowerType = application.borrower_type || DEFAULT_BORROWER_TYPE_FOR_CATEGORY[application.category];
  const disbursementDate = application.disbursement_date || new Date().toISOString().slice(0, 10);

  if (!product || !borrowerType || !application.loan_amount || !application.repayment_months) return null;

  return computeLoan({
    product,
    borrowerType,
    amountRequired: Number(application.loan_amount),
    disbursementDate,
    tenorMonths: Number(application.repayment_months),
    config,
  });
}

module.exports = {
  getConfig,
  setConfig,
  computeLoan,
  computeForApplication,
  suggestRepaymentStartDate,
  DEFAULT_PRODUCTS,
  DEFAULT_UPFRONT,
  DEFAULT_PRODUCT_FOR_CATEGORY,
  DEFAULT_BORROWER_TYPE_FOR_CATEGORY,
  INTEREST_METHOD,
  DATE_RULE,
  REPAYMENT_TYPE,
};
