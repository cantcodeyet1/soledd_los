/**
 * loanCalculator.service.js — Soledd Team Loan Calculator, reverse-engineered
 * from the client's "Soledd_Simple_Team_Loan_Calculator_Setup_Hidden.xlsx".
 *
 * Every figure below (product rates, upfront-charge rates, the equal-instalment
 * discount-factor math, the Farm Shop straight-line method) is a direct
 * transcription of that workbook's formulas, verified against its own worked
 * example (Farm Shop, $1000, 3 months, salaried, disbursed 2026-07-29) —
 * every output value matched exactly, including float precision.
 *
 * One deliberate deviation from the workbook's *documentation*: the sheet's
 * labels/notes all say the collection fee is 5%, but its live formulas
 * (Calculator!B25, Amortisation!H) actually reference a mislabeled cell and
 * compute 10.5%. Per client instruction, this port matches the live 10.5%
 * behaviour, not the (likely unintentional) documented 5%. Both the rate and
 * everything else here are stored in `settings` and editable from the
 * dashboard, so this can be corrected in one field if/when the client fixes
 * their sheet.
 */

'use strict';

const settingsService = require('./settings.service');

const INTEREST_METHOD = {
  ACTUAL_DAY: 'ACTUAL_DAY',
  STRAIGHT_LINE_30: 'STRAIGHT_LINE_30',
};

const DEFAULT_PRODUCTS = {
  STANDARD_USD: { label: 'Standard USD', monthlyRatePct: 10, collectionFeeApplies: false, interestMethod: INTEREST_METHOD.ACTUAL_DAY },
  SSB:            { label: 'SSB', monthlyRatePct: 10, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.ACTUAL_DAY },
  PENSIONS:       { label: 'Pensions', monthlyRatePct: 10, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.ACTUAL_DAY },
  ZIG_LOAN_20:    { label: 'ZiG Loan 20%', monthlyRatePct: 20, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.ACTUAL_DAY },
  FARM_SHOP:      { label: 'Farm Shop', monthlyRatePct: 5, collectionFeeApplies: true, interestMethod: INTEREST_METHOD.STRAIGHT_LINE_30 },
};

// Shared across all products (only the bank charge branches for ZiG).
const DEFAULT_UPFRONT = {
  immtPct: 2,
  bankChargePct: 1,
  zigBankChargePct: 2,
  zigBankChargeMin: 100,
  establishmentFeePct: 5,
  loanProtectionFeePct: 2.5,
  collectionFeePct: 10.5, // see file header — matches the client's live spreadsheet, not its documentation
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

function daysBetween(d1, d2) {
  return Math.round((toUtcDate(d2).getTime() - toUtcDate(d1).getTime()) / 86400000);
}

function isoDate(d) {
  return toUtcDate(d).toISOString().slice(0, 10);
}

function firstRepaymentDate(borrowerType, disbursementDate) {
  return borrowerType === 'SALARIED' ? eomonth(disbursementDate, 1) : edate(disbursementDate, 1);
}

function nextRepaymentDate(borrowerType, prevDate) {
  return borrowerType === 'SALARIED' ? eomonth(prevDate, 1) : edate(prevDate, 1);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Core calculation ───────────────────────────────────────────────────────

function computeUpfrontCharges(productCode, amountRequired, upfront) {
  const immt = amountRequired * (upfront.immtPct / 100);
  const bankCharge = productCode === 'ZIG_LOAN_20'
    ? Math.max(amountRequired * (upfront.zigBankChargePct / 100), upfront.zigBankChargeMin)
    : amountRequired * (upfront.bankChargePct / 100);
  const establishment = amountRequired * (upfront.establishmentFeePct / 100);
  const loanProtection = amountRequired * (upfront.loanProtectionFeePct / 100);
  return {
    immt, bankCharge, establishment, loanProtection,
    total: immt + bankCharge + establishment + loanProtection,
  };
}

/**
 * @param product        one of the keys in config.products (e.g. 'FARM_SHOP')
 * @param borrowerType   'SALARIED' | 'NON_SALARIED'
 * @param amountRequired cash amount the client wants (before upfront charges are capitalised)
 * @param disbursementDate Date | ISO string
 * @param tenorMonths    number of instalments
 * @param config         { products, upfront } — from getConfig()
 */
function computeLoan({ product, borrowerType, amountRequired, disbursementDate, tenorMonths, config }) {
  const cfg = config.products[product];
  if (!cfg) throw new Error(`Unknown product: ${product}`);
  if (!(tenorMonths > 0)) throw new Error('tenorMonths must be > 0');

  const monthlyRate = cfg.monthlyRatePct / 100;
  const charges = computeUpfrontCharges(product, amountRequired, config.upfront);
  const grossLoan = amountRequired + charges.total;

  // Repayment dates + day-counts per period, needed by both interest methods.
  const dates = [];
  const days = [];
  for (let i = 0; i < tenorMonths; i++) {
    const d = i === 0 ? firstRepaymentDate(borrowerType, disbursementDate) : nextRepaymentDate(borrowerType, dates[i - 1]);
    dates.push(d);
    const dayCount = cfg.interestMethod === INTEREST_METHOD.STRAIGHT_LINE_30
      ? 30
      : daysBetween(i === 0 ? disbursementDate : dates[i - 1], d);
    days.push(dayCount);
  }

  // Equal instalment (before collection fee), solved once for the whole loan.
  let instalmentExclCF;
  if (cfg.interestMethod === INTEREST_METHOD.STRAIGHT_LINE_30) {
    instalmentExclCF = (grossLoan + grossLoan * monthlyRate * tenorMonths) / tenorMonths;
  } else if (monthlyRate === 0) {
    instalmentExclCF = grossLoan / tenorMonths;
  } else {
    let k = 1;
    let sumDiscountFactors = 0;
    for (let i = 0; i < tenorMonths; i++) {
      const periodRate = monthlyRate * days[i] / 30;
      k = i === 0 ? 1 + periodRate : k * (1 + periodRate);
      sumDiscountFactors += 1 / k;
    }
    instalmentExclCF = grossLoan / sumDiscountFactors;
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
    } else {
      interest = opening * monthlyRate * days[i] / 30;
      instalment = Math.min(instalmentExclCF, opening + interest);
      principal = instalment - interest;
      closing = Math.max(0, opening + interest - instalment);
    }

    const collectionFee = cfg.collectionFeeApplies ? instalment * collectionFeeRate : 0;
    const totalInstalment = instalment + collectionFee;

    schedule.push({
      no: i + 1,
      date: isoDate(dates[i]),
      days: days[i],
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

  const firstCollectionFee = cfg.collectionFeeApplies ? instalmentExclCF * collectionFeeRate : 0;

  return {
    product,
    productLabel: cfg.label,
    borrowerType,
    monthlyRatePct: cfg.monthlyRatePct,
    interestMethod: cfg.interestMethod,
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
    collectionFee: round2(firstCollectionFee),
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
  SME: 'STANDARD_USD',
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
  DEFAULT_PRODUCTS,
  DEFAULT_UPFRONT,
  DEFAULT_PRODUCT_FOR_CATEGORY,
  DEFAULT_BORROWER_TYPE_FOR_CATEGORY,
};
