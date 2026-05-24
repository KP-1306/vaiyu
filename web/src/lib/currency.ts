// web/src/lib/currency.ts
// Single source of truth for currency formatting across VAiyu.
// Until a `hotels.currency_code` column ships, DEFAULT_CURRENCY is INR.
// Consumers that have a hotel in scope should pass its currency explicitly.

export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP" | "AED";

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

const LOCALE_BY_CURRENCY: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  EUR: "en-IE",
  GBP: "en-GB",
  AED: "en-AE",
};

// Lazy-cached Intl.NumberFormat instances. Constructing NumberFormat is
// non-trivial; we memoize per (currency, maximumFractionDigits) pair.
const cache = new Map<string, Intl.NumberFormat>();

function nf(currency: CurrencyCode, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}|${fractionDigits}`;
  let v = cache.get(key);
  if (!v) {
    v = new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency], {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    cache.set(key, v);
  }
  return v;
}

export type FormatMoneyOptions = {
  currency?: CurrencyCode;
  // Whole rupees/dollars by default — typical for hotel nightly rates.
  fractionDigits?: number;
};

export function formatMoney(amount: number, opts: FormatMoneyOptions = {}): string {
  const currency = opts.currency ?? DEFAULT_CURRENCY;
  const fractionDigits = opts.fractionDigits ?? 0;
  return nf(currency, fractionDigits).format(amount);
}

// Back-compat helper for call sites that still use `formatINR`.
export function formatINR(amount: number): string {
  return formatMoney(amount, { currency: "INR" });
}
