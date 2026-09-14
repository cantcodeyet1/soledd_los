/**
 * aiFieldExtractor.service.js — uses Groq (an LLM) to turn the "all in one
 * message" WhatsApp answers (name+title together, phone+address together,
 * bank name+account together, next-of-kin name+address+phone+relationship
 * together) into clean, separated fields before they get placed into the
 * exact boxes on the real paper-form PDFs.
 *
 * This is a pure enhancement layer: scripts/fill_forms.py already has
 * regex-based splitters (split_name/split_contact/split_bank/split_personal)
 * and keeps using them as a fallback whenever this returns null — a missing
 * key, a Groq outage, a timeout, or a malformed response never blocks PDF
 * generation or the bot flow.
 */

'use strict';

const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';
const TIMEOUT_MS = 12000;

const SYSTEM_PROMPT = `You extract clean, structured loan-application fields from raw WhatsApp answers written by a Zimbabwean microfinance applicant. The applicant often answers several questions in one free-text message - for example name and title together, phone numbers and address together, bank name and account number together, or next-of-kin name/address/phone/relationship together.

Reply with ONLY a single JSON object, no prose, no markdown fences. Use "" for any field you cannot find in the text - never guess, never invent, never fill in an example value. Keep values as the applicant wrote them (fix obvious spacing/typos only, do not reword or translate).

Return exactly this shape:
{
  "title": "Mr./Mrs./Ms./Miss/Dr./Prof./Rev. or empty",
  "firstNames": "given names only, no title, no surname",
  "surname": "surname/family name only",
  "phone1": "primary phone number, digits and leading + only",
  "phone2": "second phone number if a second one was given, else empty",
  "residentialAddress": "home/physical address only, no phone numbers in it",
  "dob": "date of birth if given, written as DD/MM/YYYY",
  "bankName": "bank name only, no branch, no account number",
  "bankAccount": "bank account number, digits only",
  "nextOfKinName": "next of kin full name only",
  "nextOfKinAddress": "next of kin address only, no phone numbers in it",
  "nextOfKinPhone": "next of kin phone number, digits and leading + only",
  "nextOfKinRelationship": "relationship to the applicant if stated, else empty",
  "purposeOfLoan": "a short, clean purpose of loan, no extra commentary"
}`;

/**
 * @param answers  application.extra_details — the raw combined WhatsApp
 *                 answers (nameLine, contactLine, personalDetails,
 *                 bankDetails, nextOfKin, purposeOfLoan, ...).
 * @returns a partial fields object (missing keys just mean "nothing found"),
 *          or null if AI extraction isn't available/failed for any reason.
 */
async function extractFields(answers) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  if (!answers || typeof answers !== 'object') return null;

  const relevant = {
    nameLine: answers.nameLine || '',
    contactLine: answers.contactLine || '',
    personalDetails: answers.personalDetails || '',
    // bankDetails (SSB/GOVT_PENSIONER/SME) and bankersDetails
    // (PRIVATE_SECTOR) are the same "bank name + account number in one
    // message" question under two different field names - send whichever
    // is present.
    bankDetails: answers.bankDetails || answers.bankersDetails || '',
    nextOfKin: answers.nextOfKin || '',
    purposeOfLoan: answers.purposeOfLoan || '',
  };
  if (!Object.values(relevant).some(v => String(v).trim())) return null;

  try {
    const res = await axios.post(
      GROQ_URL,
      {
        model: MODEL,
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Raw answers (JSON):\n${JSON.stringify(relevant)}` },
        ],
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: TIMEOUT_MS,
      }
    );

    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    console.error('[AI_EXTRACT] Groq extraction failed, falling back to regex splitting:', err.message);
    return null;
  }
}

module.exports = { extractFields };
