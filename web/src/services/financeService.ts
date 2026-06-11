// web/src/services/financeService.ts
// VAiyu Finance Module – categories, budgets, expenses, revenue, summary

import { supabase } from '../lib/supabase';
import type {
  FinanceCategory,
  FinanceBudgetPlan,
  FinanceExpense,
  FinanceManualRevenue,
  FinanceSummary,
  CategorySummary,
  ExpenseFormData,
  RevenueFormData,
} from '../types/finance';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function toMonthStart(yearMonth: string): string {
  // '2024-06' -> '2024-06-01'
  return `${yearMonth}-01`;
}

export function currentYearMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(hotelId: string): Promise<FinanceCategory[]> {
  const { data, error } = await supabase
    .from('finance_categories')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('active', true)
    .order('name');

  if (error) throw error;
  return (data ?? []) as FinanceCategory[];
}

export async function ensureCategoriesSeeded(hotelId: string): Promise<void> {
  const { count } = await supabase
    .from('finance_categories')
    .select('id', { count: 'exact', head: true })
    .eq('hotel_id', hotelId);

  if ((count ?? 0) === 0) {
    const { error } = await supabase.rpc('seed_default_finance_categories', {
      p_hotel_id: hotelId,
    });
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Budget plans
// ---------------------------------------------------------------------------

export async function listBudgetPlans(
  hotelId: string,
  yearMonth: string,
): Promise<FinanceBudgetPlan[]> {
  const monthDate = toMonthStart(yearMonth);

  const { data, error } = await supabase
    .from('finance_budget_plans')
    .select(`
      *,
      finance_categories ( id, name, code )
    `)
    .eq('hotel_id', hotelId)
    .eq('budget_month', monthDate)
    .order('finance_categories(name)', { ascending: true });

  if (error) throw error;
  return (data ?? []) as FinanceBudgetPlan[];
}

export async function upsertBudgetPlan(
  hotelId: string,
  userId: string,
  yearMonth: string,
  categoryId: string,
  budgetAmount: number,
  notes?: string | null,
): Promise<void> {
  const monthDate = toMonthStart(yearMonth);

  const { error } = await supabase
    .from('finance_budget_plans')
    .upsert(
      {
        hotel_id: hotelId,
        budget_month: monthDate,
        category_id: categoryId,
        budget_amount: budgetAmount,
        notes: notes ?? null,
        created_by: userId,
      },
      { onConflict: 'hotel_id,budget_month,category_id' },
    );

  if (error) throw error;
}

export async function deleteBudgetPlan(
  hotelId: string,
  yearMonth: string,
  categoryId: string,
): Promise<void> {
  const monthDate = toMonthStart(yearMonth);

  const { error } = await supabase
    .from('finance_budget_plans')
    .delete()
    .eq('hotel_id', hotelId)
    .eq('budget_month', monthDate)
    .eq('category_id', categoryId);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export async function listExpenses(
  hotelId: string,
  yearMonth?: string,
): Promise<FinanceExpense[]> {
  let query = supabase
    .from('finance_expenses')
    .select(`
      *,
      finance_categories ( id, name, code )
    `)
    .eq('hotel_id', hotelId)
    .order('expense_date', { ascending: false })
    .limit(200);

  if (yearMonth) {
    const start = toMonthStart(yearMonth);
    const end = new Date(
      new Date(start).getFullYear(),
      new Date(start).getMonth() + 1,
      0,
    )
      .toISOString()
      .slice(0, 10);
    query = query.gte('expense_date', start).lte('expense_date', end);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FinanceExpense[];
}

export async function createExpense(
  hotelId: string,
  userId: string,
  form: ExpenseFormData,
): Promise<FinanceExpense> {
  const { data, error } = await supabase
    .from('finance_expenses')
    .insert({
      hotel_id: hotelId,
      created_by: userId,
      expense_date: form.expense_date,
      category_id: form.category_id,
      amount: Number(form.amount),
      description: form.description,
      vendor_name: form.vendor_name || null,
      payment_mode: form.payment_mode || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FinanceExpense;
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from('finance_expenses').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Manual revenue
// ---------------------------------------------------------------------------

export async function listManualRevenue(
  hotelId: string,
  yearMonth: string,
): Promise<FinanceManualRevenue[]> {
  const start = toMonthStart(yearMonth);
  const end = new Date(
    new Date(start).getFullYear(),
    new Date(start).getMonth() + 1,
    0,
  )
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from('finance_manual_revenue')
    .select('*')
    .eq('hotel_id', hotelId)
    .gte('revenue_date', start)
    .lte('revenue_date', end)
    .order('revenue_date', { ascending: false });

  if (error) throw error;
  return (data ?? []) as FinanceManualRevenue[];
}

export async function createManualRevenue(
  hotelId: string,
  userId: string,
  form: RevenueFormData,
): Promise<FinanceManualRevenue> {
  const { data, error } = await supabase
    .from('finance_manual_revenue')
    .insert({
      hotel_id: hotelId,
      created_by: userId,
      revenue_date: form.revenue_date,
      revenue_type: form.revenue_type,
      amount: Number(form.amount),
      notes: form.notes || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as FinanceManualRevenue;
}

export async function deleteManualRevenue(id: string): Promise<void> {
  const { error } = await supabase
    .from('finance_manual_revenue')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Finance summary (budget vs actual for a month)
// ---------------------------------------------------------------------------

export async function getFinanceSummary(
  hotelId: string,
  yearMonth: string,
): Promise<FinanceSummary> {
  const [categories, budgetPlans, expenses, revenues] = await Promise.all([
    listCategories(hotelId),
    listBudgetPlans(hotelId, yearMonth),
    listExpenses(hotelId, yearMonth),
    listManualRevenue(hotelId, yearMonth),
  ]);

  const budgetByCategory = new Map(
    budgetPlans.map((b) => [b.category_id, b.budget_amount]),
  );

  const spendByCategory = expenses.reduce<Map<string, number>>((acc, e) => {
    acc.set(e.category_id, (acc.get(e.category_id) ?? 0) + e.amount);
    return acc;
  }, new Map());

  const categoryRows: CategorySummary[] = categories.map((cat) => {
    const budget = budgetByCategory.get(cat.id) ?? 0;
    const actual = spendByCategory.get(cat.id) ?? 0;
    const remaining = budget - actual;
    const utilization_pct = budget > 0 ? (actual / budget) * 100 : 0;
    const status =
      budget === 0
        ? 'ok'
        : utilization_pct >= 100
        ? 'exceeded'
        : utilization_pct >= 80
        ? 'near_limit'
        : 'ok';

    return {
      category_id: cat.id,
      category_name: cat.name,
      category_code: cat.code,
      budget_amount: budget,
      actual_spend: actual,
      remaining,
      status,
      utilization_pct,
    };
  });

  const total_budget = categoryRows.reduce((s, c) => s + c.budget_amount, 0);
  const total_expense = categoryRows.reduce((s, c) => s + c.actual_spend, 0);
  const total_revenue = revenues.reduce((s, r) => s + r.amount, 0);

  return {
    month: yearMonth,
    total_budget,
    total_expense,
    total_revenue,
    remaining_budget: total_budget - total_expense,
    operating_profit: total_revenue - total_expense,
    categories: categoryRows,
  };
}

/* ============================================================
   Outstanding Folio Balance — owner dashboard signal
   "Money owed by currently in-house guests."
   ============================================================ */

export type OutstandingBalanceSummary = {
  totalOwed: number;          // sum of positive balances across OPEN folios
  staysWithBalance: number;   // count of OPEN folios with a positive balance
  totalOpenFolios: number;    // count of all OPEN folios (settled or not)
  guestRefundOwed: number;    // negative-balance OPEN folios (hotel owes guest)
};

/**
 * Returns aggregate outstanding-balance numbers for the owner dashboard.
 * Computed by summing folio_entries.amount per OPEN folio (charges positive,
 * payments/discounts negative). Filters out closed folios.
 *
 * Data volume note: scales linearly with active folio entries. Fine up to a
 * few thousand entries per hotel — for larger properties this should move
 * into a server-side view or RPC.
 */
export async function getOutstandingBalanceSummary(
  hotelId: string,
): Promise<OutstandingBalanceSummary> {
  const empty: OutstandingBalanceSummary = {
    totalOwed: 0,
    staysWithBalance: 0,
    totalOpenFolios: 0,
    guestRefundOwed: 0,
  };
  if (!hotelId) return empty;

  // Pull all entries for OPEN folios in one round-trip
  const { data, error } = await supabase
    .from('folio_entries')
    .select('folio_id, amount, folios!inner(status)')
    .eq('hotel_id', hotelId)
    .eq('folios.status', 'OPEN');

  if (error || !data) return empty;

  // Aggregate per folio
  const balanceByFolio = new Map<string, number>();
  for (const row of data as { folio_id: string; amount: number | string }[]) {
    const cur = balanceByFolio.get(row.folio_id) ?? 0;
    balanceByFolio.set(row.folio_id, cur + Number(row.amount));
  }

  let totalOwed = 0;
  let staysWithBalance = 0;
  let guestRefundOwed = 0;
  for (const balance of balanceByFolio.values()) {
    if (balance > 0.005) {
      totalOwed += balance;
      staysWithBalance += 1;
    } else if (balance < -0.005) {
      guestRefundOwed += -balance;
    }
  }

  return {
    totalOwed: Math.round(totalOwed * 100) / 100,
    staysWithBalance,
    totalOpenFolios: balanceByFolio.size,
    guestRefundOwed: Math.round(guestRefundOwed * 100) / 100,
  };
}

/* ============================================================
   Housekeeping summary — owner dashboard inventory glance
   "How many rooms can we actually sell right now?"
   ============================================================ */

export type HousekeepingSummary = {
  total: number;        // total rooms in the hotel
  ready: number;        // inspected + clean (sellable)
  inspected: number;    // subset of ready
  clean: number;        // subset of ready
  dirty: number;
  pickup: number;       // guest just left, awaiting cleaning kickoff
  inProgress: number;   // being cleaned right now
  outOfOrder: number;   // is_out_of_order=true OR housekeeping_status='out_of_order'
  readyPct: number;     // ready/total * 100, rounded
};

/**
 * Aggregates room counts by housekeeping_status for an at-a-glance dashboard
 * card. A room with is_out_of_order=true is counted as OOO regardless of its
 * housekeeping_status — OOO is the more urgent operational truth.
 */
export async function getHousekeepingSummary(
  hotelId: string,
): Promise<HousekeepingSummary> {
  const empty: HousekeepingSummary = {
    total: 0, ready: 0, inspected: 0, clean: 0,
    dirty: 0, pickup: 0, inProgress: 0, outOfOrder: 0, readyPct: 0,
  };
  if (!hotelId) return empty;

  const { data, error } = await supabase
    .from('rooms')
    .select('housekeeping_status, is_out_of_order')
    .eq('hotel_id', hotelId);

  if (error || !data) return empty;

  const out = { ...empty, total: data.length };
  for (const r of data as { housekeeping_status: string; is_out_of_order: boolean | null }[]) {
    if (r.is_out_of_order || r.housekeeping_status === 'out_of_order') {
      out.outOfOrder += 1;
      continue;
    }
    switch (r.housekeeping_status) {
      case 'inspected': out.inspected += 1; out.ready += 1; break;
      case 'clean':     out.clean += 1;     out.ready += 1; break;
      case 'dirty':     out.dirty += 1; break;
      case 'pickup':    out.pickup += 1; break;
      case 'in_progress': out.inProgress += 1; break;
    }
  }
  out.readyPct = out.total > 0 ? Math.round((out.ready / out.total) * 100) : 0;
  return out;
}

/* ============================================================
   Forecast — next 7 days arrivals pipeline
   "What's coming?" — reframes a quiet day with the week ahead.
   ============================================================ */

export type ForecastDay = {
  dateISO: string;     // YYYY-MM-DD in hotel timezone
  dayLabel: string;    // "Today" | "Mon" | "Tue"…
  arrivals: number;    // bookings expected to check in that day
  rooms: number;       // sum of rooms_total across those bookings
  isToday: boolean;
};

export type ForecastSummary = {
  days: ForecastDay[];
  totalArrivals: number;
  totalRooms: number;
  peakDay: ForecastDay | null;
};

const FORECAST_DAYS = 7;

/**
 * Returns a 7-day arrivals pipeline starting today (IST). Excludes bookings
 * already cancelled, no-show, or already past the arrival event so the count
 * represents only "expected to arrive."
 */
export async function getArrivalsForecast(
  hotelId: string,
  timezone: string = 'Asia/Kolkata',
): Promise<ForecastSummary> {
  const empty: ForecastSummary = { days: [], totalArrivals: 0, totalRooms: 0, peakDay: null };
  if (!hotelId) return empty;

  // Build [today 00:00, today+7 00:00) — both interpreted in the hotel's TZ
  const todayYmd = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const offsetMin = zoneOffsetMinutes(timezone, new Date());
  // UTC instant of "todayYmd 00:00:00 in {timezone}":
  const startUtc = new Date(Date.parse(`${todayYmd}T00:00:00Z`) - offsetMin * 60_000);
  const endUtc = new Date(startUtc.getTime() + FORECAST_DAYS * 86_400_000);

  // Pre-build the 7-day skeleton so empty days still render
  const dayMap = new Map<string, ForecastDay>();
  for (let i = 0; i < FORECAST_DAYS; i += 1) {
    const d = new Date(startUtc.getTime() + i * 86_400_000);
    const ymd = d.toLocaleDateString('en-CA', { timeZone: timezone });
    const label = i === 0
      ? 'Today'
      : i === 1
        ? 'Tomorrow'
        : d.toLocaleDateString(undefined, { weekday: 'short', timeZone: timezone });
    dayMap.set(ymd, {
      dateISO: ymd,
      dayLabel: label,
      arrivals: 0,
      rooms: 0,
      isToday: i === 0,
    });
  }

  const { data, error } = await supabase
    .from('bookings')
    .select('scheduled_checkin_at, rooms_total, status')
    .eq('hotel_id', hotelId)
    .gte('scheduled_checkin_at', startUtc.toISOString())
    .lt('scheduled_checkin_at', endUtc.toISOString())
    .not('status', 'in', '(CANCELLED,NO_SHOW,CHECKED_OUT,CHECKED_IN,VOID)');

  if (error || !data) {
    return { days: Array.from(dayMap.values()), totalArrivals: 0, totalRooms: 0, peakDay: null };
  }

  for (const row of data as { scheduled_checkin_at: string; rooms_total: number | null }[]) {
    const ymd = new Date(row.scheduled_checkin_at).toLocaleDateString('en-CA', { timeZone: timezone });
    const slot = dayMap.get(ymd);
    if (!slot) continue;
    slot.arrivals += 1;
    slot.rooms += Number(row.rooms_total ?? 0);
  }

  const days = Array.from(dayMap.values());
  let totalArrivals = 0;
  let totalRooms = 0;
  let peakDay: ForecastDay | null = null;
  for (const d of days) {
    totalArrivals += d.arrivals;
    totalRooms += d.rooms;
    if (d.arrivals > 0 && (peakDay === null || d.arrivals > peakDay.arrivals)) {
      peakDay = d;
    }
  }

  return { days, totalArrivals, totalRooms, peakDay };
}

// Returns the offset of `timezone` from UTC in minutes at the given instant.
// IST → +330, UTC → 0, Asia/Dubai → +240, America/New_York → -240/-300 (DST).
// Computed by rendering the same instant in both zones and diffing parsed values.
function zoneOffsetMinutes(timezone: string, at: Date): number {
  const utcStr = at.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
  const localStr = at.toLocaleString('en-US', { timeZone: timezone, hour12: false });
  return Math.round((Date.parse(localStr) - Date.parse(utcStr)) / 60_000);
}



