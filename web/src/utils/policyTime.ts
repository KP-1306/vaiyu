// policyTime.ts — format a hotel's policy check-in/out time for guest display.
//
// Source is hotels.default_checkin_time / default_checkout_time (Postgres
// `time without time zone`), surfaced to guests via v_public_hotels and
// delivered by PostgREST as a string like "14:00:00" / "11:00:00".
//
// Returns a 12-hour label ("2:00 PM", "11:00 AM", "12:00 PM" for noon) or null
// when the hotel has not configured the time. Callers render the date alone when
// this is null — we never fabricate a clock time the hotel hasn't set.
export function formatPolicyTime(t: string | null | undefined): string | null {
    if (!t) return null;
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return null;
    let h = Number(m[1]);
    const min = Number(m[2]);
    if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return null;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${String(min).padStart(2, "0")} ${ampm}`;
}
