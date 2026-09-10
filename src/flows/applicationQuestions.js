/**
 * applicationQuestions.js — per-category question sequences, mirroring the
 * paper application forms field-for-field:
 *   - Government (Civil Servants / Government Pensioners): loan agreement form
 *   - SME: Business Loan Application form
 *   - Private Sector Employees: Loan Application form
 *
 * Naturally-clustered fields (name, contact details, bank details) are asked
 * as one combined question rather than one message per field, to keep the
 * chat shorter. Fields that feed a real database column on their own
 * (National ID, loan amount, repayment period, and SME's company name, which
 * doubles as employer_name) stay as individual questions so their values
 * stay clean and parseable.
 *
 * Each question: { field, prompt, type, options?, skipIf?(answersSoFar) }
 * type: 'text' | 'amount' | 'yesno' | 'choice' | 'period'
 */

'use strict';

/** "Please send these in one message:\n\n* Item one\n* Item two"
 *  (WhatsApp renders a line starting with "* " as a bullet). */
function bulletPrompt(intro, items) {
  return `${intro}\n\n${items.map(i => `* ${i}`).join('\n')}`;
}

const GOV_SME_PERIODS = [
  { months: 3,  label: '3 months' },
  { months: 6,  label: '6 months' },
  { months: 12, label: '12 months' },
];

const PRIVATE_SECTOR_PERIODS = [
  { months: 3,  label: '3 months' },
  { months: 6,  label: '6 months' },
  { months: 12, label: '12 months' },
  { months: 18, label: '18 months' },
];

function governmentQuestions(employerQuestion) {
  const qs = [
    { field: 'nameLine',           prompt: 'What is your title, first name(s), and surname? (e.g. Mr Tinashe Moyo)', type: 'text' },
    { field: 'nationalId',         prompt: 'What is your National ID number?', type: 'text' },
    { field: 'contactLine',        prompt: bulletPrompt('Please send these in one message:', ['Telephone / mobile number', 'Residential address']), type: 'text' },
    { field: 'nextOfKin',          prompt: bulletPrompt("Your next of kin's details, in one message:", ['Full name', 'Address', 'Phone number']), type: 'text' },
  ];
  if (employerQuestion) {
    qs.push({ field: 'employerName', prompt: employerQuestion, type: 'text' });
  }
  qs.push(
    { field: 'bankDetails',    prompt: bulletPrompt('Your bank details, in one message:', ['Bank name', 'Account number']), type: 'text' },
    { field: 'sourceOfIncome', prompt: 'What is your source of income to meet the repayment?', type: 'choice', options: ['Monthly Salary', 'Remittances from Diaspora', 'Sale of Asset', 'Other'] },
    { field: 'purposeOfLoan',  prompt: 'What is the purpose of this loan?', type: 'text' },
    { field: 'loanAmount',     prompt: 'How much would you like to borrow, in USD?', type: 'amount' },
    { field: 'repaymentMonths', prompt: 'Choose a repayment period.', type: 'period', options: GOV_SME_PERIODS },
  );
  return qs;
}

const SSB_QUESTIONS = governmentQuestions('Which ministry or department do you work for?');
const GOVT_PENSIONER_QUESTIONS = governmentQuestions(null);

const SME_QUESTIONS = [
  { field: 'nameLine',         prompt: 'What is your title and first name(s)? (e.g. Mr Chipo)', type: 'text' },
  { field: 'surname',          prompt: 'What is your surname or registered company name?', type: 'text' },
  { field: 'nationalId',       prompt: 'What is your ID number (or company registration number)?', type: 'text' },
  { field: 'address',          prompt: bulletPrompt('Please send these in one message:', ['Residential address', 'Business address']), type: 'text' },
  { field: 'repaymentSource',  prompt: "If repayment is from business income, tell us your business address/location. If from employment, tell us your employer's name. You'll be able to send a payslip and bank statement as a document later.", type: 'text' },
  { field: 'nextOfKin',        prompt: bulletPrompt("Next of Kin (or Company Director) details, in one message:", ['Full name', 'Address', 'Phone number']), type: 'text' },
  { field: 'qualifications',   prompt: 'What are your qualifications, skills, and experience?', type: 'text' },
  { field: 'natureOfBusiness', prompt: 'What is the nature of your business?', type: 'text' },
  { field: 'yearsInIndustry',  prompt: 'How long have you (or the company) been in this industry?', type: 'text' },
  { field: 'securityPledged',  prompt: 'What security are you pledging to secure this loan?', type: 'text' },
  { field: 'blacklisted',      prompt: 'Have you or the business ever been blacklisted or failed to pay your debts?', type: 'yesno' },
  { field: 'bankDetails',      prompt: bulletPrompt('Your bank details, in one message:', ['Bank name', 'Branch', 'Account number']), type: 'text' },
  { field: 'purposeOfLoan',    prompt: 'What is the purpose of this loan?', type: 'text' },
  { field: 'transactionHistory', prompt: 'How many times have you successfully done a similar transaction? Please provide details.', type: 'text' },
  { field: 'loanAmount',       prompt: 'How much would you like to borrow, in USD?', type: 'amount' },
  { field: 'repaymentMonths',  prompt: 'Choose a repayment period.', type: 'period', options: GOV_SME_PERIODS },
];

const PRIVATE_SECTOR_QUESTIONS = [
  { field: 'nameLine',        prompt: 'What is your title, first name(s), and surname? (e.g. Mr Tapiwa Ncube)', type: 'text' },
  { field: 'nationalId',      prompt: 'What is your ID/Passport number?', type: 'text' },
  { field: 'personalDetails', prompt: bulletPrompt('Please send these in one message:', ['Date of birth', 'Physical address', 'Contact number']), type: 'text' },
  { field: 'nextOfKin',       prompt: bulletPrompt("Your next of kin's details, in one message:", ['Full name', 'Address', 'Phone number', 'Relationship to you']), type: 'text' },
  { field: 'maritalStatus',   prompt: 'What is your marital status?', type: 'text' },
  {
    field: 'spouseDetails',
    prompt: "Please provide your spouse's full name, age, years married, and contact details.",
    type: 'text',
    skipIf: a => !/marri/i.test(a.maritalStatus || ''),
  },
  { field: 'childrenDetails', prompt: 'Do you have children? If so, how many, which school(s) do they attend, and what are the total school fees? (reply N/A if none)', type: 'text' },
  { field: 'monthlyBudget',   prompt: bulletPrompt('Your monthly budget, in one message:', ['Total income', 'Total living expenses', 'Mortgage / rent (if any)']), type: 'text' },
  { field: 'loanAmount',      prompt: 'How much would you like to borrow, in USD?', type: 'amount' },
  { field: 'repaymentMonths', prompt: 'Choose a repayment period.', type: 'period', options: PRIVATE_SECTOR_PERIODS },
  { field: 'purposeOfLoan',   prompt: 'What is the purpose of this loan?', type: 'choice', options: ['Working Capital', 'Asset finance', 'Inputs finance', 'Solar Asset finance', 'Other'] },
  { field: 'purchaseDetails', prompt: 'If financing a purchase, please provide the invoice amount and your deposit (reply N/A if not applicable).', type: 'text' },
  { field: 'formallyEmployed', prompt: 'Are you formally employed?', type: 'yesno' },
  { field: 'employerName',      prompt: 'What is the name of your employer?', type: 'text', skipIf: a => a.formallyEmployed !== 'YES' },
  { field: 'employmentDuration', prompt: 'How long have you been employed, and is it permanent or contract?', type: 'text', skipIf: a => a.formallyEmployed !== 'YES' },
  { field: 'employerAddress',   prompt: "What is your employer's address?", type: 'text', skipIf: a => a.formallyEmployed !== 'YES' },
  { field: 'incomeSources',     prompt: 'What are your sources of income?', type: 'text', skipIf: a => a.formallyEmployed !== 'NO' },
  { field: 'businessOperation', prompt: 'Where do you operate from, how long have you been operating, and what line of business are you in?', type: 'text', skipIf: a => a.formallyEmployed !== 'NO' },
  { field: 'majorClients',      prompt: 'Who are your major clients: individuals or corporates? If corporates, please list your top two.', type: 'text', skipIf: a => a.formallyEmployed !== 'NO' },
  { field: 'takeHomeIncome',  prompt: 'What is your take-home monthly income?', type: 'amount' },
  { field: 'hasDeposit',      prompt: 'Do you have the 30% deposit required?', type: 'yesno' },
  { field: 'depositSource',   prompt: 'What is the source of the deposit?', type: 'choice', options: ['Savings', 'Diaspora', 'Income from work', 'Other'] },
  { field: 'ownVehicle',      prompt: 'Do you own a motor vehicle?', type: 'yesno' },
  { field: 'ownProperty',     prompt: 'Do you own a fixed property?', type: 'yesno' },
  { field: 'propertyPurchaseMethod', prompt: 'How did you purchase the fixed property?', type: 'choice', options: ['Mortgage', 'Savings', 'Income', 'Other'], skipIf: a => a.ownProperty !== 'YES' },
  { field: 'assetPropertyOwner', prompt: 'Who owns the property where the asset/equipment will be installed? (e.g. you, parents, landlord, other)', type: 'text' },
  { field: 'bankersDetails',  prompt: 'Who are your bankers, and what is your account number?', type: 'text' },
  { field: 'banksIncome',     prompt: 'Do you bank your income?', type: 'yesno' },
  { field: 'borrowedBefore',  prompt: 'Have you borrowed money from a financial institution in the last 12 months?', type: 'yesno' },
  { field: 'lenderDetails',   prompt: 'Please provide details of the lender, and confirm you repaid without legal action.', type: 'text', skipIf: a => a.borrowedBefore !== 'YES' },
  { field: 'blacklisted',           prompt: 'Have you ever been blacklisted or had a court judgment against you in the last 12 months?', type: 'yesno' },
  { field: 'understandObligations', prompt: 'Do you understand your monthly obligations if the loan is approved?', type: 'yesno' },
  { field: 'understandDefault',     prompt: 'Do you understand the consequences of default?', type: 'yesno' },
  { field: 'defaultPlan',           prompt: 'If you default, what other plan do you have to settle the debt?', type: 'text' },
];

function questionsForCategory(categoryCode) {
  switch (categoryCode) {
    case 'SSB':             return SSB_QUESTIONS;
    case 'GOVT_PENSIONER':  return GOVT_PENSIONER_QUESTIONS;
    case 'SME':              return SME_QUESTIONS;
    case 'PRIVATE_SECTOR':  return PRIVATE_SECTOR_QUESTIONS;
    default:                 return [];
  }
}

module.exports = { questionsForCategory };
