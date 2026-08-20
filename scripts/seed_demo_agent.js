#!/usr/bin/env node
/**
 * seed_demo_agent.js — creates a fake, already-verified field agent plus a
 * handful of applications attributed to them, so the dashboard has
 * something realistic to click through during a demo.
 *
 * Run via: node scripts/seed_demo_agent.js
 */

require('dotenv').config();
const { supabase } = require('../src/models/supabase');

const AGENT_PHONE = '263775550100';

async function main() {
  await supabase.from('customers').upsert({ phone_number: AGENT_PHONE, name: 'Farai Sibanda' });

  const { data: agent, error: agentErr } = await supabase
    .from('agents')
    .upsert({
      phone_number: AGENT_PHONE,
      name: 'Farai Sibanda',
      region: 'Harare Central',
      verified: true,
      active: true,
      otp_code: null,
      otp_expires_at: null,
    }, { onConflict: 'phone_number' })
    .select()
    .single();
  if (agentErr) throw agentErr;
  console.log('✅ Demo agent ready:', agent.name, agent.phone_number);

  const clients = [
    { phone: '263775550101', name: 'Client One' },
    { phone: '263775550102', name: 'Client Two' },
    { phone: '263775550103', name: 'Client Three' },
    { phone: '263775550104', name: 'Client Four' },
    { phone: '263775550105', name: 'Client Five' },
  ];
  for (const c of clients) {
    await supabase.from('customers').upsert({ phone_number: c.phone, name: c.name });
  }

  // extra_details mirrors what the real WhatsApp form flow captures beyond
  // the summary fields (applicationEngine.js's `answers` object) — filled in
  // here with realistic values so the dashboard's "Full Application Details"
  // section has something to show for demo/testing purposes.
  const applications = [
    {
      applicant_phone: clients[0].phone, category: 'SSB', full_name: 'Tendai Moyo', national_id: '63-100001-A10',
      employer_name: 'Ministry of Health', loan_amount: 1200, repayment_months: 6, status: 'APPROVED',
      extra_details: {
        nameLine: 'Mr Tendai Moyo', nationalId: '63-100001-A10',
        contactLine: '0772 345 678, 14 Josiah Tongogara St, Harare',
        nextOfKin: 'Rutendo Moyo, 14 Josiah Tongogara St, Harare, 0772 345 679',
        employerName: 'Ministry of Health', bankDetails: 'CBZ Bank, Account 01123456789012',
        sourceOfIncome: 'Monthly Salary', purposeOfLoan: 'School fees for children',
      },
    },
    {
      applicant_phone: clients[1].phone, category: 'SME', full_name: 'Chipo Dziva', national_id: '63-100002-A11',
      employer_name: 'Dziva Trading', loan_amount: 3500, repayment_months: 12, status: 'APPROVED',
      extra_details: {
        nameLine: 'Mrs Chipo', surname: 'Dziva Trading', nationalId: '63-100002-A11',
        address: '22 Robert Mugabe Rd, Bulawayo (residential); Stand 45 Belmont Industrial (business)',
        repaymentSource: 'Business income — retail hardware store, Belmont Industrial, Bulawayo',
        nextOfKin: 'Tafara Dziva (Director), same address, 0773 456 789',
        qualifications: 'Diploma in Business Management, 8 years retail experience',
        natureOfBusiness: 'Hardware and building supplies retail',
        yearsInIndustry: '6 years',
        securityPledged: 'Delivery vehicle, Toyota Hilux 2019, ZW reg AEB 1234',
        blacklisted: 'NO',
        bankDetails: 'Stanbic Bank, Belmont Branch, Account 9001234567',
        purposeOfLoan: 'Stock replenishment ahead of the festive season',
        transactionHistory: 'Two prior loans with another lender, both settled on time',
      },
    },
    {
      applicant_phone: clients[2].phone, category: 'PRIVATE_SECTOR', full_name: 'Tapiwa Ncube', national_id: '63-100003-A12',
      employer_name: 'Econet Wireless', loan_amount: 800, repayment_months: 3, status: 'IN_REVIEW',
      extra_details: {
        nameLine: 'Mr Tapiwa Ncube', nationalId: '63-100003-A12',
        personalDetails: '14 March 1990, 8 Fife Avenue, Harare, 0774 567 890',
        nextOfKin: 'Farirai Ncube (brother), 8 Fife Avenue, Harare, 0774 567 891',
        maritalStatus: 'Single',
        childrenDetails: 'N/A',
        monthlyBudget: 'Income $650, Living expenses $300, Rent $150',
        purposeOfLoan: 'Working Capital', purchaseDetails: 'N/A',
        formallyEmployed: 'YES', employerName: 'Econet Wireless',
        employmentDuration: '4 years, permanent', employerAddress: '2nd Floor, Econet Park, Msasa, Harare',
      },
    },
    {
      applicant_phone: clients[3].phone, category: 'GOVT_PENSIONER', full_name: 'Ropafadzo Chuma', national_id: '63-100004-A13',
      employer_name: null, loan_amount: 600, repayment_months: 6, status: 'IN_REVIEW',
      extra_details: {
        nameLine: 'Mrs Ropafadzo Chuma', nationalId: '63-100004-A13',
        contactLine: '0775 678 901, 5 Chinhoyi St, Mutare',
        nextOfKin: 'Simbarashe Chuma, 5 Chinhoyi St, Mutare, 0775 678 902',
        bankDetails: 'POSB, Account 3300987654', sourceOfIncome: 'Monthly Salary',
        purposeOfLoan: 'Medical expenses',
      },
    },
    {
      applicant_phone: clients[4].phone, category: 'SSB', full_name: 'Blessing Sibanda', national_id: '63-100005-A14',
      employer_name: 'Ministry of Education', loan_amount: 950, repayment_months: 12, status: 'REJECTED',
      extra_details: {
        nameLine: 'Ms Blessing Sibanda', nationalId: '63-100005-A14',
        contactLine: '0776 789 012, 31 Kaguvi St, Gweru',
        nextOfKin: 'Nomatter Sibanda, 31 Kaguvi St, Gweru, 0776 789 013',
        employerName: 'Ministry of Education', bankDetails: 'ZB Bank, Account 44567890123',
        sourceOfIncome: 'Monthly Salary', purposeOfLoan: 'Home renovations',
      },
    },
  ];

  for (const app of applications) {
    const { data: existing } = await supabase
      .from('applications')
      .select('id')
      .eq('national_id', app.national_id)
      .maybeSingle();
    if (existing) {
      await supabase.from('applications').update({ extra_details: app.extra_details || {} }).eq('id', existing.id);
      console.log('↷ Already seeded, backfilled extra_details:', app.full_name);
      continue;
    }

    const { data: inserted, error } = await supabase
      .from('applications')
      .insert([{ ...app, agent_phone: AGENT_PHONE, extra_details: app.extra_details || {} }])
      .select()
      .single();
    if (error) throw error;
    console.log(`  + ${inserted.reference_number} — ${inserted.full_name} (${inserted.status})`);
  }

  console.log('\nDone. Demo agent phone:', AGENT_PHONE);
}

main().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
