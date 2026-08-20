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

module.exports = { buildCrystalExport, buildAgentsExport };
