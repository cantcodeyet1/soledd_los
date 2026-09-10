/**
 * crystalExport.service.js — builds an Excel export of approved loans for
 * import into Loan Performer (Crystal).
 *
 * NOTE: Crystal's exact import template (column names/order) has not been
 * provided. This uses a reasonable, commonly-used column set for MFI loan
 * imports — verify against Soledd's actual Crystal import template and
 * adjust COLUMNS below once available.
 */

'use strict';

const ExcelJS = require('exceljs');

const CATEGORY_LABELS = {
  SSB: 'Civil Servants (SSB)',
  GOVT_PENSIONER: 'Government Pensioners',
  SME: 'SME',
  PRIVATE_SECTOR: 'Private Sector Employees',
};

const COLUMNS = [
  { header: 'Reference Number', key: 'reference_number', width: 16 },
  { header: 'Full Name', key: 'full_name', width: 26 },
  { header: 'National ID', key: 'national_id', width: 18 },
  { header: 'Phone Number', key: 'applicant_phone', width: 16 },
  { header: 'Loan Product', key: 'category', width: 22 },
  { header: 'Employer / Business', key: 'employer_name', width: 24 },
  { header: 'Loan Amount (USD)', key: 'loan_amount', width: 16 },
  { header: 'Repayment Period (Months)', key: 'repayment_months', width: 14 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Application Date', key: 'created_at', width: 18 },
  { header: 'Field Agent', key: 'agent_phone', width: 16 },
];

async function buildCrystalExport(applications) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Loans');

  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };

  for (const app of applications) {
    sheet.addRow({
      reference_number: app.reference_number,
      full_name: app.full_name,
      national_id: app.national_id,
      applicant_phone: app.applicant_phone,
      category: CATEGORY_LABELS[app.category] || app.category,
      employer_name: app.employer_name || '',
      loan_amount: Number(app.loan_amount),
      repayment_months: app.repayment_months,
      status: app.status,
      created_at: new Date(app.created_at).toLocaleDateString('en-ZW', { timeZone: 'Africa/Harare' }),
      agent_phone: app.agent_phone || '',
    });
  }

  return workbook.xlsx.writeBuffer();
}

const AGENT_COLUMNS = [
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Phone', key: 'phone_number', width: 16 },
  { header: 'Region', key: 'region', width: 18 },
  { header: 'Status', key: 'status', width: 14 },
  { header: 'Total Loans', key: 'total', width: 12 },
  { header: 'Approved', key: 'approved', width: 10 },
  { header: 'Pending', key: 'pending', width: 10 },
  { header: 'Approval Rate (%)', key: 'approvalRate', width: 16 },
  { header: 'Remuneration (USD)', key: 'totalRemuneration', width: 18 },
  { header: 'Joined', key: 'created_at', width: 16 },
];

async function buildAgentsExport(agents) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Field Agents');

  sheet.columns = AGENT_COLUMNS;
  sheet.getRow(1).font = { bold: true };

  for (const a of agents) {
    const status = !a.verified ? 'Pending OTP' : a.active ? 'Active' : 'Deactivated';
    sheet.addRow({
      name: a.name || '',
      phone_number: a.phone_number,
      region: a.region || '',
      status,
      total: a.performance.total,
      approved: a.performance.approved,
      pending: a.performance.pending,
      approvalRate: a.performance.approvalRate,
      totalRemuneration: a.performance.totalRemuneration,
      created_at: new Date(a.created_at).toLocaleDateString('en-ZW', { timeZone: 'Africa/Harare' }),
    });
  }

  return workbook.xlsx.writeBuffer();
}

// ─── LMS monthly repayment-postings export ─────────────────────────────────
// Mirrors the client's "PEN <PERIOD> POSTINGS.xlsx" sample:
//   Sheet1 — the import batch itself, one row per approved loan:
//     Loan Number   → applications.lms_loan_number, else the LOS reference
//                     (staff fill lms_loan_number in once the loan is booked
//                     in the LMS so it matches the LMS's own account number)
//     Repayment Date→ month-end of the selected month
//     Repaid Amount → this month's total instalment (incl. collection fee),
//                     from the loan calculator
//     Mode          → config.mode (default 1)
//     Cheque No.    → 0
//     Recalculate / Cleared / Clearing date / Close loan… / Member No. → blank
//     Voucher No.   → "<voucherPrefix> <MONTH> <YEAR>", e.g. "PEN USD JANUARY 2026"
//     Gl. Account   → config.glAccount (default "127010")
//     savprodid     → config.savProdId (default "S00")
//   Sheet2 — Name / Amount / Loan Number reconciliation list.
// glAccount, savProdId, mode and voucherPrefix are editable in Profile → LMS
// Export (settings key 'lms_postings_config').

const LMS_SHEET1_COLUMNS = [
  'Loan Number', 'Repayment Date', 'Repaid Amount', 'Mode', 'Cheque No.',
  'Recalculate', 'Voucher No.', 'Gl. Account', 'Cleared', 'Clearing date',
  'Close loan with No interest? ', 'Member No.', 'savprodid',
];

const MONTH_NAMES = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

async function buildLmsPostingsExport(rows, { year, month0, config = {} }) {
  const glAccount = String(config.glAccount || '127010');
  const savProdId = String(config.savProdId || 'S00');
  const mode = config.mode == null ? 1 : Number(config.mode);
  const voucherPrefix = config.voucherPrefix || 'PEN USD';
  const voucherNo = `${voucherPrefix} ${MONTH_NAMES[month0]} ${year}`;
  const repaymentDate = new Date(year, month0 + 1, 0); // last day of the month

  const workbook = new ExcelJS.Workbook();

  const sheet1 = workbook.addWorksheet('Sheet1');
  sheet1.addRow(LMS_SHEET1_COLUMNS);
  sheet1.getRow(1).font = { bold: true };

  const sheet2 = workbook.addWorksheet('Sheet2');

  for (const { application, computed } of rows) {
    const loanNumber = application.lms_loan_number || application.reference_number;
    const amount = computed ? round2(computed.totalMonthlyInstalment) : round2(monthlyFallback(application));

    sheet1.addRow([
      loanNumber, repaymentDate, amount, mode, 0,
      null, voucherNo, glAccount, null, null,
      null, null, savProdId,
    ]);
    sheet2.addRow([application.full_name, amount, loanNumber]);
  }

  sheet1.getColumn(2).numFmt = 'yyyy-mm-dd';
  sheet1.getColumn(3).numFmt = '0.00';
  sheet1.getColumn(1).width = 16;
  sheet1.getColumn(7).width = 24;
  sheet2.getColumn(1).width = 32;
  sheet2.getColumn(3).width = 16;

  return workbook.xlsx.writeBuffer();
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Very rough fallback if the calculator can't price a loan: straight
 *  principal / tenor. Real figures always come from computed. */
function monthlyFallback(application) {
  const months = Number(application.repayment_months) || 1;
  return (Number(application.loan_amount) || 0) / months;
}

module.exports = { buildCrystalExport, buildAgentsExport, buildLmsPostingsExport };
