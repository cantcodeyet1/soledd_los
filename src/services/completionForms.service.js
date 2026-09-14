/**
 * completionForms.service.js — at the end of a WhatsApp application, builds
 * the "please sign these" package: the filled loan agreement / application
 * form, plus the relevant salary or pension deduction ("stop order") form,
 * with the applicant's details and provisional loan figures already filled
 * in. flow.service.js sends each of these to the applicant on WhatsApp.
 *
 * SME has no deduction form — SME loans repay from business income, not a
 * salary/pension deduction.
 */

'use strict';

const loanCalculator = require('./loanCalculator.service');
const pdfFormFill = require('./pdfFormFill.service');
const aiFieldExtractor = require('./aiFieldExtractor.service');

const DEDUCTION_FORM_BY_CATEGORY = {
  SSB:            { kind: 'DEDUCTION_SSB',      label: 'SSB stop order (salary deduction form)' },
  GOVT_PENSIONER: { kind: 'DEDUCTION_PENSIONS', label: 'Pensions stop order (deduction form)' },
  PRIVATE_SECTOR: { kind: 'DEDUCTION_PRIVATE',  label: 'USD salary deduction form' },
};

/**
 * @returns [{ key, filename, buffer }] — 1-2 PDFs. Empty if nothing could
 *          be generated (Python/pdf tooling unavailable, etc.).
 */
async function buildCompletionForms(application) {
  const computed = await loanCalculator.computeForApplication(application).catch(() => null);
  const answers = application.extra_details || {};

  // AI layer: turns the "all in one message" combined answers into clean,
  // separated fields (name parts, individual phone numbers, bank name vs
  // account number, next-of-kin parts, ...) so fill_forms.py can place each
  // piece in its own box precisely. Best-effort - fill_forms.py falls back
  // to its own regex splitters whenever this comes back null.
  const aiFields = await aiFieldExtractor.extractFields(answers).catch(() => null);

  const payload = {
    answers,
    aiFields: aiFields || undefined,
    application: {
      applicantPhone: application.applicant_phone,
      loanAmount: application.loan_amount,
      repaymentMonths: application.repayment_months,
      fullName: application.full_name,
      nationalId: application.national_id,
      employerName: application.employer_name,
      referenceNumber: application.reference_number,
      lmsLoanNumber: application.lms_loan_number || null,
    },
    computed,
  };

  const ref = application.reference_number || 'application';
  const who = (application.full_name || '').replace(/[^\w .'-]/g, '').replace(/\s+/g, ' ').trim();
  const stem = [ref, who].filter(Boolean).join(' ');
  const forms = [];

  const agreement = await pdfFormFill.fillFormPdf(application.category, payload).catch(() => null);
  if (agreement) forms.push({ key: 'agreement', filename: `${stem} Loan Agreement.pdf`, buffer: agreement });

  const ded = DEDUCTION_FORM_BY_CATEGORY[application.category];
  if (ded) {
    const dedBuf = await pdfFormFill.fillDeductionForm(ded.kind, payload).catch(() => null);
    if (dedBuf) forms.push({ key: 'deduction', filename: `${stem} ${ded.label}.pdf`, buffer: dedBuf });
  }

  return forms;
}

module.exports = { buildCompletionForms, DEDUCTION_FORM_BY_CATEGORY };
