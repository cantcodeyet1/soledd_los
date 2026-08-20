/**
 * requiredDocuments.js — per-category document checklist, sent to the
 * applicant right after their application is submitted.
 *
 * SOURCE NOTE: "List of necessary documents.docx" lists 12 candidate
 * document types across 5 categories as a matrix, but every checkbox cell
 * in that table was left blank (verified against the raw XML — no
 * checkmarks, symbols, or cell shading). The lists below were synthesized
 * from that candidate pool combined with the "Attach the following
 * documents" sections already printed on the SME and Private Sector paper
 * forms (which are specific). Worth a quick sanity check against what
 * Soledd actually collects per category.
 */

'use strict';

const REQUIRED_DOCUMENTS = {
  SSB: [
    'Certified copy of ID',
    'Payslip',
    '3 months bank statements',
    'Letter of employment showing your address',
    'Proof of residence (water/ZESA bill)',
    'Signed deduction code',
    'Signed application form',
    'Signed loan agreement',
  ],
  GOVT_PENSIONER: [
    'Certified copy of ID',
    '3 months bank statements',
    'Proof of residence (water/ZESA bill)',
    'Proof of income (pension confirmation)',
    'Signed application form',
    'Signed loan agreement',
  ],
  SME: [
    'Certified copy of ID (applicant and at least one director)',
    'Copy of security documents',
    'Proof of residence (not older than 3 months)',
    'Proof of income (cash flow/budget, contract, or consignment order)',
    'Curriculum vitae / business profile',
    'Signed application form',
    'Signed loan agreement',
  ],
  PRIVATE_SECTOR: [
    'Certified copy of ID',
    'Payslip',
    '3 months bank statements',
    'Letter of employment showing your address',
    'Proof of residence (water/ZESA bill)',
    'Proof of income',
    'Signed application form',
    'Signed loan agreement',
  ],
  // "Become an Agent" — vetting documents, not a loan category, but reuses
  // the same generic document-collection engine.
  AGENT_APPLICATION: [
    'Certified copy of ID',
    'Proof of residence (water/ZESA bill)',
    'Recent passport-size photo',
  ],
};

function requiredDocumentsMessage(categoryCode) {
  const docs = REQUIRED_DOCUMENTS[categoryCode] || [];
  if (docs.length === 0) return null;
  return 'To complete your application, please have these documents ready:\n\n' +
    docs.map(d => `• ${d}`).join('\n') +
    '\n\nA credit officer will let you know how to send them.';
}

module.exports = { REQUIRED_DOCUMENTS, requiredDocumentsMessage };
