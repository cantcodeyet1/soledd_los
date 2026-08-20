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
  created_at: string;
  updated_at: string;
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

export type LoanProduct = 'STANDARD_USD' | 'SSB' | 'PENSIONS' | 'ZIG_LOAN_20' | 'FARM_SHOP';
export type BorrowerType = 'SALARIED' | 'NON_SALARIED';
export type InterestMethod = 'ACTUAL_DAY' | 'STRAIGHT_LINE_30';

export const LOAN_PRODUCT_LABELS: Record<LoanProduct, string> = {
  STANDARD_USD: 'Standard USD',
  SSB: 'SSB',
  PENSIONS: 'Pensions',
  ZIG_LOAN_20: 'ZiG Loan 20%',
  FARM_SHOP: 'Farm Shop',
};

export interface ProductConfig {
  label: string;
  monthlyRatePct: number;
  collectionFeeApplies: boolean;
  interestMethod: InterestMethod;
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
  days: number;
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
