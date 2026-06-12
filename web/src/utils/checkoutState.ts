// web/src/utils/checkoutState.ts
// Shared checkout-urgency logic for the arrivals board AND the guest drawer.
// Single source of truth so the two surfaces can never disagree on whether a
// guest is "Departing today" vs "Overdue". IST-aware, time-precision.

import { parseDbDate } from "./dateUtils";

export type CheckoutState = "overdue" | "today" | "future" | "na";

function ymdInIST(d: Date | null): string | null {
    if (!d) return null;
    // 'en-CA' formats as YYYY-MM-DD; combined with timeZone gives the IST date string.
    return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function computeCheckoutState(
    arrival: { arrival_operational_state: string; scheduled_checkout_at?: string | null },
    now: Date,
): { state: CheckoutState; hoursLate: number; daysLate: number } {
    const isInHouse = [
        "CHECKED_IN",
        "PARTIALLY_ARRIVED",
        "CHECKOUT_REQUESTED",
    ].includes(arrival.arrival_operational_state);
    if (!isInHouse || !arrival.scheduled_checkout_at) return { state: "na", hoursLate: 0, daysLate: 0 };

    const checkoutDate = parseDbDate(arrival.scheduled_checkout_at);
    if (!checkoutDate) return { state: "na", hoursLate: 0, daysLate: 0 };

    const diffMs = now.getTime() - checkoutDate.getTime();
    if (diffMs > 0) {
        const hoursLate = Math.max(1, Math.floor(diffMs / 3_600_000));
        const daysLate = Math.floor(hoursLate / 24);
        return { state: "overdue", hoursLate, daysLate };
    }

    // Future — same IST calendar day means "departing today"
    const checkoutISTDate = ymdInIST(checkoutDate);
    const nowISTDate = ymdInIST(now);
    if (checkoutISTDate === nowISTDate) return { state: "today", hoursLate: 0, daysLate: 0 };
    return { state: "future", hoursLate: 0, daysLate: 0 };
}
