/**
 * pdfFormFill.service.js — fills the real Soledd paper-form PDF templates
 * with an application's answers, by shelling out to scripts/fill_forms.py
 * (pdfplumber + reportlab overlay). Requires Python 3 with pdfplumber,
 * pypdf, and reportlab installed on the host (see scripts/fill_forms.py).
 *
 * Falls back to null on any failure — the caller should fall back to the
 * generated-summary PDF (pdfExport.service.js) rather than error out.
 */

'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FILL_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'fill_forms.py');

// Templates only exist for these categories.
const SUPPORTED_CATEGORIES = new Set(['SSB', 'GOVT_PENSIONER', 'SME', 'PRIVATE_SECTOR']);
const DEDUCTION_KINDS = new Set(['DEDUCTION_SSB', 'DEDUCTION_PENSIONS', 'DEDUCTION_PRIVATE']);

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: PROJECT_ROOT, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

/** Runs fill_forms.py <arg> and returns the output PDF Buffer, or null. */
async function _runFill(arg, payload) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'soledd-pdf-'));
  const answersPath = path.join(tmpDir, 'answers.json');
  const outputPath = path.join(tmpDir, 'output.pdf');
  try {
    await fs.writeFile(answersPath, JSON.stringify(payload), 'utf-8');
    let lastErr;
    for (const cmd of ['python3', 'python']) {
      try {
        await run(cmd, [FILL_SCRIPT, arg, answersPath, outputPath]);
        return await fs.readFile(outputPath);
      } catch (err) {
        lastErr = err;
      }
    }
    console.error(`[PDF_FILL] fill_forms.py ${arg} failed:`, lastErr?.message);
    return null;
  } catch (err) {
    console.error('[PDF_FILL] error:', err.message);
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param categoryCode SSB | GOVT_PENSIONER | SME | PRIVATE_SECTOR
 * @param payload      { answers, application, computed }
 * Returns a filled-PDF Buffer, or null if the template fill isn't available/fails.
 */
async function fillFormPdf(categoryCode, payload) {
  if (!SUPPORTED_CATEGORIES.has(categoryCode)) return null;
  return _runFill(categoryCode, payload);
}

/**
 * Fills a salary/pension "stop order" deduction form.
 * @param kind DEDUCTION_SSB | DEDUCTION_PENSIONS | DEDUCTION_PRIVATE
 */
async function fillDeductionForm(kind, payload) {
  if (!DEDUCTION_KINDS.has(kind)) return null;
  return _runFill(kind, payload);
}

module.exports = { fillFormPdf, fillDeductionForm };
