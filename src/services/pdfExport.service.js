/**
 * pdfExport.service.js — generates a clean, branded PDF summary of a loan
 * application (all captured answers, in the order they were asked). Not a
 * pixel replica of the paper form — a formatted document built from the
 * same data, which stays correct regardless of how the question set evolves.
 */

'use strict';

const PDFDocument = require('pdfkit');
const { questionsForCategory } = require('../flows/applicationQuestions');

const CATEGORY_LABELS = {
  SSB: 'Civil Servants',
  GOVT_PENSIONER: 'Government Pensioners',
  SME: 'Small to Medium Enterprises',
  PRIVATE_SECTOR: 'Private Sector Employees',
};

function buildApplicationPdf(application, computed) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).fillColor('#003049').text('Soledd Financial Services', { continued: false });
    doc.fontSize(10).fillColor('#5B6472').text('Registered Microfinance Institution, Suite 5, Baddow Court, 45 Livingstone Ave, Harare');
    doc.moveDown(0.5);
    doc.strokeColor('#003049').lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    doc.fontSize(15).fillColor('#003049').text('Loan Application Summary');
    doc.moveDown(0.3);

    doc.fontSize(10).fillColor('#232B36');
    doc.text(`Reference:  ${application.reference_number || 'PENDING'}`);
    doc.text(`Category:   ${CATEGORY_LABELS[application.category] || application.category}`);
    doc.text(`Status:     ${application.status}`);
    doc.text(`Submitted:  ${new Date(application.created_at).toLocaleString('en-ZW', { timeZone: 'Africa/Harare' })}`);
    doc.moveDown(1);

    // Q&A pairs, in the order they were asked
    const questions = questionsForCategory(application.category);
    const answers = application.extra_details || {};

    doc.fontSize(12).fillColor('#003049').text('Application Details');
    doc.moveDown(0.3);
    doc.strokeColor('#DBDAD3').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    for (const q of questions) {
      const value = answers[q.field];
      if (value === undefined || value === null || value === '') continue;
      const display = q.type === 'period' ? `${value} months` : String(value);

      doc.fontSize(9).fillColor('#5B6472').text(q.prompt);
      doc.fontSize(11).fillColor('#232B36').text(display, { paragraphGap: 8 });
      doc.moveDown(0.2);

      if (doc.y > 740) doc.addPage();
    }

    doc.moveDown(1);
    doc.fontSize(12).fillColor('#003049').text('Facility Summary');
    doc.moveDown(0.3);
    doc.strokeColor('#DBDAD3').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#232B36');
    doc.text(`Loan Amount:        $${Number(application.loan_amount).toFixed(2)}`);
    doc.text(`Repayment Period:   ${application.repayment_months} months`);
    doc.text(`Applicant Name:     ${application.full_name}`);
    doc.text(`National ID:        ${application.national_id}`);
    if (application.employer_name) doc.text(`Employer/Business:  ${application.employer_name}`);
    if (application.agent_phone) doc.text(`Field Agent:        ${application.agent_phone}`);

    if (computed) {
      doc.moveDown(1);
      doc.fontSize(12).fillColor('#003049').text('Repayment Terms');
      doc.moveDown(0.3);
      doc.strokeColor('#DBDAD3').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor('#232B36');
      doc.text(`Product:             ${computed.productLabel} (${computed.monthlyRatePct}% monthly)`);
      doc.text(`Monthly Instalment:  $${computed.totalMonthlyInstalment.toFixed(2)}`);
      doc.text(`First Repayment:     ${computed.firstRepaymentDate}`);
      doc.text(`Final Repayment:     ${computed.finalRepaymentDate}`);
      doc.text(`Total Payable:       $${computed.totalPayable.toFixed(2)}`);
    }

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#5B6472').text(
      'This document is a system-generated summary of information submitted via WhatsApp and does not replace a signed loan agreement.',
      { width: 495 }
    );

    doc.end();
  });
}

module.exports = { buildApplicationPdf };
