-- Soledd LOS — WhatsApp loan origination
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query)

-- ─── customers ──────────────────────────────────────────────────────────────
-- One row per WhatsApp number. A customer can have multiple applications
-- over time (loans are re-appliable).
create table if not exists customers (
  phone_number text primary key,
  name         text,              -- WhatsApp profile name (not verified identity)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── applications ───────────────────────────────────────────────────────────
create sequence if not exists applications_ref_seq start 100;

create table if not exists applications (
  id                uuid primary key default gen_random_uuid(),
  reference_number  text unique,                 -- filled by trigger below, e.g. LOS-0142
  applicant_phone   text not null references customers(phone_number),
  category          text not null check (category in ('SSB', 'GOVT_PENSIONER', 'SME', 'PRIVATE_SECTOR')),
  full_name         text not null,
  national_id       text not null,
  employer_name     text,                          -- ministry/employer/business name; null for Government Pensioners
  loan_amount       numeric not null check (loan_amount > 0),
  repayment_months  integer not null check (repayment_months in (3, 6, 12, 18)),
  extra_details     jsonb not null default '{}'::jsonb, -- full paper-form answers not captured in dedicated columns
  status            text not null default 'IN_REVIEW'
                       check (status in ('IN_REVIEW', 'APPROVED', 'REJECTED')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create or replace function set_application_reference()
returns trigger as $$
begin
  if new.reference_number is null then
    new.reference_number := 'LOS-' || lpad(nextval('applications_ref_seq')::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_application_reference on applications;
create trigger trg_set_application_reference
before insert on applications
for each row execute function set_application_reference();

-- ─── agents (field agents, dashboard-managed, OTP-verified via WhatsApp) ────
create table if not exists agents (
  id               uuid primary key default gen_random_uuid(),
  phone_number     text unique not null,
  name             text,
  region           text,
  otp_code         text,
  otp_expires_at   timestamptz,
  verified         boolean not null default false,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─── credit_officers (dashboard-managed, no WhatsApp workflow) ──────────────
create table if not exists credit_officers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text,
  branch       text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─── settings (key-value store, e.g. configurable loan calculator rates) ────
create table if not exists settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ─── agent_applications ─────────────────────────────────────────────────────
create table if not exists agent_applications (
  id                uuid primary key default gen_random_uuid(),
  applicant_phone   text not null references customers(phone_number),
  full_name         text not null,
  national_id       text not null,
  area              text not null,
  status            text not null default 'PENDING_REVIEW'
                       check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_agent_applications_phone on agent_applications(applicant_phone);

-- ─── documents (uploaded via WhatsApp, stored in Supabase Storage) ──────────
create table if not exists documents (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications(id),
  label           text not null,       -- which required document this fulfills, e.g. 'Payslip'
  storage_path    text not null,       -- path within the 'documents' Storage bucket
  mime_type       text,
  uploaded_at     timestamptz not null default now()
);

create index if not exists idx_documents_application on documents(application_id);

-- Private bucket — the backend (secret key) reads/writes directly; no public
-- URL access. Safe to re-run.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- ─── conversation_states ────────────────────────────────────────────────────
-- One row per WhatsApp number tracking where they are in the flow.
create table if not exists conversation_states (
  customer_phone   text primary key references customers(phone_number),
  flow             text,             -- e.g. 'NEW_APPLICATION'
  step             text,             -- current step within the flow
  flow_data        jsonb not null default '{}'::jsonb,
  bot_paused       boolean not null default false,
  last_message_at  timestamptz,
  updated_at       timestamptz not null default now()
);

-- ─── conversations ──────────────────────────────────────────────────────────
-- Message log, used for dedup + debugging.
create table if not exists conversations (
  id                   uuid primary key default gen_random_uuid(),
  customer_phone       text not null,
  message_text         text,
  direction            text not null check (direction in ('inbound', 'outbound')),
  whatsapp_message_id  text,
  timestamp            timestamptz not null default now(),
  sent_by              text not null check (sent_by in ('customer', 'bot'))
);

create index if not exists idx_conversations_phone on conversations(customer_phone);
create index if not exists idx_conversations_wa_id on conversations(whatsapp_message_id);
create index if not exists idx_applications_phone on applications(applicant_phone);

-- Row Level Security is left disabled — the backend connects with the
-- Supabase secret key (full access), and there is no browser-facing client yet.

-- ─── Migration (safe to re-run) ─────────────────────────────────────────────
-- Relax employer_name (Government Pensioners have no employer question) and
-- update the category set to match the new 4-category menu.
alter table applications alter column employer_name drop not null;

alter table applications drop constraint if exists applications_category_check;
alter table applications add constraint applications_category_check
  check (category in ('SSB', 'GOVT_PENSIONER', 'SME', 'PRIVATE_SECTOR'));

alter table applications add column if not exists extra_details jsonb not null default '{}'::jsonb;

alter table applications drop constraint if exists applications_repayment_months_check;
alter table applications add constraint applications_repayment_months_check
  check (repayment_months in (3, 6, 12, 18));

alter table applications add column if not exists agent_phone text references agents(phone_number);
create index if not exists idx_applications_agent_phone on applications(agent_phone);

-- Default loan calculator config, editable from the dashboard Calculator page.
-- Reverse-engineered from the client's "Soledd Simple Team Loan Calculator" workbook.
-- Note: collectionFeePct is 10.5, matching that workbook's live formulas — its own
-- labels/notes say 5%, but its Calculator!B25 / Amortisation!H formulas actually
-- reference the wrong cell. Per client instruction this mirrors the live (buggy)
-- behaviour rather than the documented rate; change this one field if that's ever fixed.
insert into settings (key, value) values
  ('loan_calculator_config', '{
    "products": {
      "STANDARD_USD": { "label": "Standard USD", "monthlyRatePct": 10, "collectionFeeApplies": false, "interestMethod": "ACTUAL_DAY" },
      "SSB":           { "label": "SSB", "monthlyRatePct": 10, "collectionFeeApplies": true, "interestMethod": "ACTUAL_DAY" },
      "PENSIONS":      { "label": "Pensions", "monthlyRatePct": 10, "collectionFeeApplies": true, "interestMethod": "ACTUAL_DAY" },
      "ZIG_LOAN_20":   { "label": "ZiG Loan 20%", "monthlyRatePct": 20, "collectionFeeApplies": true, "interestMethod": "ACTUAL_DAY" },
      "FARM_SHOP":     { "label": "Farm Shop", "monthlyRatePct": 5, "collectionFeeApplies": true, "interestMethod": "STRAIGHT_LINE_30" }
    },
    "upfront": {
      "immtPct": 2,
      "bankChargePct": 1,
      "zigBankChargePct": 2,
      "zigBankChargeMin": 100,
      "establishmentFeePct": 5,
      "loanProtectionFeePct": 2.5,
      "collectionFeePct": 10.5
    }
  }'::jsonb)
on conflict (key) do nothing;

delete from settings where key = 'calculator_rates';

-- credit_officers: switch identifying contact from phone to email.
alter table credit_officers add column if not exists email text;
alter table credit_officers drop column if exists phone_number;

-- Per-loan calculator terms, so the repayment schedule shown on an
-- application is that account's own (not a re-typed what-if quote).
alter table applications add column if not exists loan_product text;
alter table applications add column if not exists borrower_type text;
alter table applications add column if not exists disbursement_date date;

-- Give credit officers their own dashboard login (email + password, invited
-- with a temp password they must reset on first login) instead of only the
-- one shared admin password. role gates access: STAFF = application queue +
-- calculator (use) + field agents; ADMIN = everything, including calculator
-- rates and managing other officer accounts. The original shared
-- ADMIN_PASSWORD login still works and is treated as ADMIN.
alter table credit_officers add column if not exists password_hash text;
alter table credit_officers add column if not exists role text not null default 'STAFF';
alter table credit_officers add column if not exists must_reset_password boolean not null default true;
alter table credit_officers drop constraint if exists credit_officers_role_check;
alter table credit_officers add constraint credit_officers_role_check check (role in ('STAFF', 'ADMIN'));

-- Agent applications ("Become an Agent" via WhatsApp) now collect documents
-- too, same as loan applications, so `documents` needs to be able to point
-- at either kind of application. Exactly one of the two FKs is set per row.
alter table documents alter column application_id drop not null;
alter table documents add column if not exists agent_application_id uuid references agent_applications(id);
create index if not exists idx_documents_agent_application on documents(agent_application_id);
alter table documents drop constraint if exists documents_one_parent_check;
alter table documents add constraint documents_one_parent_check check (
  (application_id is not null and agent_application_id is null) or
  (application_id is null and agent_application_id is not null)
);
