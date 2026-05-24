// web/src/types/finance.ts
// VAiyu Finance Module – Financial Intelligence Layer types

export type FinanceCategory = {
  id: string;
  hotel_id: string;
  name: string;
  code: string | null;
  active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type FinanceBudgetPlan = {
  id: string;
  hotel_id: string;
  budget_month: string;
  category_id: string;
  budget_amount: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finance_categories?: Pick<FinanceCategory, 'id' | 'name' | 'code'>;
};

export type FinanceExpense = {
  id: string;
  hotel_id: string;
  expense_date: string;
  category_id: string;
  amount: number;
  description: string;
  vendor_name: string | null;
  payment_mode: string | null;
  attachment_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  finance_categories?: Pick<FinanceCategory, 'id' | 'name' | 'code'>;
};

export type FinanceManualRevenue = {
  id: string;
  hotel_id: string;
  revenue_date: string;
  revenue_type: 'room' | 'f&b' | 'events' | 'other';
  amount: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryBudgetStatus = 'ok' | 'near_limit' | 'exceeded';

export type CategorySummary = {
  category_id: string;
  category_name: string;
  category_code: string | null;
  budget_amount: number;
  actual_spend: number;
  remaining: number;
  status: CategoryBudgetStatus;
  utilization_pct: number;
};

export type FinanceSummary = {
  month: string;
  total_budget: number;
  total_expense: number;
  total_revenue: number;
  remaining_budget: number;
  operating_profit: number;
  categories: CategorySummary[];
};

export type ExpenseFormData = {
  expense_date: string;
  category_id: string;
  amount: number;
  description: string;
  vendor_name: string;
  payment_mode: string;
};

export type RevenueFormData = {
  revenue_date: string;
  revenue_type: 'room' | 'f&b' | 'events' | 'other';
  amount: number;
  notes: string;
};
