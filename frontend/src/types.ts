export type CategoryCode = 'SSB' | 'GOVT_PENSIONER' | 'SME' | 'PRIVATE_SECTOR';
export type ApplicationStatus = 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  SSB: 'Civil Servants',
  GOVT_PENSIONER: 'Government Pensioners',
  SME: 'SME',
  PRIVATE_SECTOR: 'Private Sector',
};

export interface Application {
  id: string;
  reference_number: string;
  applicant_phone: string;
  category: CategoryCode;
  full_name: string;
  national_id: string;
  employer_name: string | null;
  loan_amount: number;
  repayment_months: number;
  status: ApplicationStatus;
  agent_phone: string | null;
  extra_details: Record<string, any>;
  loan_product: LoanProduct | null;
  borrower_type: BorrowerType | null;
  disbursement_date: string | null;
  archived: boolean;
  lms_loan_number: string | null;
  agent_commission_paid?: boolean;
  created_at: string;
  updated_at: string;
}

export type ActivityType =
  | 'CREATED' | 'STATUS_CHANGED' | 'LOAN_TERMS_UPDATED' | 'AGENT_ASSIGNED'
  | 'DETAILS_EDITED' | 'INFO_REQUESTED' | 'ARCHIVED' | 'UNARCHIVED' | 'EXPORTED' | 'NOTE';

export interface ActivityEntry {
  id: string;
  application_id: string;
  type: ActivityType;
  summary: string;
  detail: Record<string, any>;
  actor_name: string | null;
  actor_email: string | null;
  created_at: string;
}

export interface Stats {
  pendingReview: number;
  approvedToday: number;
  disbursedThisMonth: number;
  activeFieldAgents: number;
}

export interface Agent {
  id: string;
  phone_number: string;
  name: string | null;
  region: string | null;
  verified: boolean;
  active: boolean;
  created_at: string;
  performance: {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    approvalRate: number;
    totalRemuneration: number;
    accruedRemuneration?: number;
    paidRemuneration?: number;
    outstandingRemuneration?: number;
  };
}

export interface Document {
  id: string;
  application_id: string;
  label: string;
  storage_path: string;
  mime_type: string | null;
  uploaded_at: string;
  url: string;
}

export type AgentApplicationStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface AgentApplication {
  id: string;
  applicant_phone: string;
  full_name: string;
  national_id: string;
  area: string;
  status: AgentApplicationStatus;
  created_at: string;
}

export type UserRole = 'STAFF' | 'ADMIN';

export interface Officer {
  id: string;
  name: string;
  email: string | null;
  branch: string | null;
  active: boolean;
  role: UserRole;
  must_reset_password: boolean;
}

export interface AuthUser {
  role: UserRole;
  name: string;
  email: string | null;
  mustResetPassword: boolean;
}

export type LoanProduct = 'STANDARD_USD' | 'SSB' | 'PENSIONS' | 'ZIG_LOAN_20' | 'FARM_SHOP' | 'SME_STANDARD' | 'SME_NEGOTIATED';
export type BorrowerType = 'SALARIED' | 'NON_SALARIED';
export type InterestMethod = 'ANNUITY' | 'STRAIGHT_LINE_30';
export type RepaymentType = 'EQUAL_INSTALMENTS' | 'INTEREST_ONLY_PRINCIPAL_AT_END';

export const LOAN_PRODUCT_LABELS: Record<LoanProduct, string> = {
  STANDARD_USD: 'Standard USD',
  SSB: 'SSB',
  PENSIONS: 'Pensions',
  ZIG_LOAN_20: 'ZiG Loan 20%',
  FARM_SHOP: 'Farm Shop',
  SME_STANDARD: 'SME Standard',
  SME_NEGOTIATED: 'SME Negotiated',
};

export interface ProductConfig {
  label: string;
  monthlyRatePct: number;
  collectionFeeApplies: boolean;
  interestMethod: InterestMethod;
  negotiable?: boolean;
}

/** SME Negotiated only — per-quote rate overrides, since its terms aren't fixed per-product. */
export interface NegotiatedRates {
  monthlyRatePct: number;
  immtPct: number;
  bankChargePct: number;
  establishmentFeePct: number;
}

export interface UpfrontConfig {
  immtPct: number;
  bankChargePct: number;
  zigBankChargePct: number;
  zigBankChargeMin: number;
  establishmentFeePct: number;
  loanProtectionFeePct: number;
  collectionFeePct: number;
}

export interface CalculatorConfig {
  products: Record<LoanProduct, ProductConfig>;
  upfront: UpfrontConfig;
}

export interface ScheduleRow {
  no: number;
  date: string;
  opening: number;
  interest: number;
  instalmentExclCollectionFee: number;
  principal: number;
  collectionFee: number;
  totalInstalment: number;
  closing: number;
}

export interface CalculatorResult {
  product: LoanProduct;
  productLabel: string;
  borrowerType: BorrowerType;
  monthlyRatePct: number;
  interestMethod: InterestMethod;
  repaymentType: RepaymentType;
  amountRequired: number;
  disbursementDate: string;
  tenorMonths: number;
  upfrontCharges: {
    immt: number;
    bankCharge: number;
    establishment: number;
    loanProtection: number;
    total: number;
  };
  grossLoanAmount: number;
  firstRepaymentDate: string;
  finalRepaymentDate: string;
  instalmentExclCollectionFee: number;
  collectionFee: number;
  totalMonthlyInstalment: number;
  totalInterest: number;
  totalCollectionFees: number;
  totalPayable: number;
  schedule: ScheduleRow[];
}

export type ConversationStatus = 'ABANDONED' | 'AWAITING_DOCS' | 'IN_PROGRESS' | 'COMPLETED';

export interface Conversation {
  phone: string;
  name: string | null;
  status: ConversationStatus;
  flow: string | null;
  step: string | null;
  botPaused: boolean;
  isAgent?: boolean;
  lastMessageText: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | null;
  lastMessageAt: string | null;
}

export interface Message {
  id: string;
  customer_phone: string;
  message_text: string | null;
  direction: 'inbound' | 'outbound';
  whatsapp_message_id: string | null;
  timestamp: string;
  sent_by: 'customer' | 'bot';
}

export interface CustomerRecord {
  phone_number: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}
