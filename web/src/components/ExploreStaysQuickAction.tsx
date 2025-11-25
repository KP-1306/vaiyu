// web/src/components/guest/ExploreStaysQuickAction.tsx
import React, { useMemo, useState } from "react";

type LocationKey = "all" | "jaipur" | "nainital" | "delhi-ncr";

type StayOption = {
  id: string;
  name: string;
  city: string;
  state: string;
  locationKey: LocationKey;
  tagline: string;
  highlights: string[];
  fromText: string; // e.g. "From ₹ 9,500 / night*"
  badge?: string;
  vibe?: string;
};

const BOOKING_EMAIL =
  import.meta.env.VITE_BOOKING_EMAIL || "bookings@vaiyu.co.in";

/** Static concierge options for now – can be moved to API later */
const STAY_OPTIONS: StayOption[] = [
  {
    id: "demo-hotel-one-jaipur",
    name: "Demo Hotel One · Jaipur",
    city: "Jaipur",
    state: "Rajasthan",
    locationKey: "jaipur",
    tagline: "Flagship luxury · Partner",
    highlights: [
      "Pool & spa",
      "Airport transfers",
      "City tours desk",
    ],
    fromText: "From ₹ 9,500 / night*",
    badge: "Most popular",
    vibe: "Boutique luxury",
  },
  {
    id: "demo-hotel-one-nainital",
    name: "Demo Hotel One · Nainital",
    city: "Nainital",
    state: "Uttarakhand",
    locationKey: "nainital",
    tagline: "Lake view · Boutique",
    highlights: [
      "Lake-facing rooms",
      "Breakfast included",
      "Early check-in on request",
    ],
    fromText: "From ₹ 7,800 / night*",
    badge: "Lake view",
    vibe: "Family & friends",
  },
  {
    id: "demo-hotel-two-delhi",
    name: "Demo Hotel Two · Delhi",
    city: "New Delhi",
    state: "NCR",
    locationKey: "delhi-ncr",
    tagline: "Business + family friendly",
    highlights: [
      "Near metro access",
      "Conference rooms",
      "24×7 room service",
    ],
    fromText: "From ₹ 8,900 / night*",
    badge: "City favourite",
    vibe: "Work trips & layovers",
  },
];

const LOCATION_FILTERS: { key: LocationKey; label: string }[] = [
  { key: "all", label: "All locations" },
  { key: "jaipur", label: "Jaipur" },
  { key: "nainital", label: "Nainital" },
  { key: "delhi-ncr", label: "Delhi NCR" },
];

export type ExploreStaysQuickActionProps = {
  open: boolean;
  onClose: () => void;
};

export default function ExploreStaysQuickAction({
  open,
  onClose,
}: ExploreStaysQuickActionProps) {
  const [activeLocation, setActiveLocation] = useState<LocationKey>("all");

  const visibleOptions = useMemo(
    () =>
      STAY_OPTIONS.filter((o) =>
        activeLocation === "all" ? true : o.locationKey === activeLocation,
      ),
    [activeLocation],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4 py-8">
      <div className="relative w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex flex-col gap-4 px-6 pb-4 pt-6">
          {/* Header */}
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
              Concierge booking · <span className="text-slate-500">Beta</span>
            </div>
            <h2 className="mt-1 text-lg md:text-xl font-semibold text-slate-900">
              Explore stays with VAiyu
            </h2>
            <p className="mt-1 text-xs md:text-sm text-slate-600 max-w-3xl">
              Right now we handle bookings with a human concierge. Pick a
              property, share your dates and we’ll confirm the best available
              rate over WhatsApp or email. Instant online booking is coming
              soon.
            </p>
          </div>

          {/* Location filters */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2 text-[11px] md:text-xs">
              <span className="self-center text-slate-500">
                Filter by location
              </span>
              {LOCATION_FILTERS.map((f) => {
                const active = activeLocation === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setActiveLocation(f.key)}
                    className={`rounded-full border px-3 py-1 ${
                      active
                        ? "border-sky-500 bg-sky-50 text-sky-800 text-xs font-medium"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="text-[11px] md:text-xs text-sky-700 underline-offset-2 hover:underline"
              onClick={() => {
                const subject = encodeURIComponent(
                  "Booking enquiry – different city (via VAiyu)",
                );
                const body = encodeURIComponent(
                  [
                    "Hi VAiyu concierge team,",
                    "",
                    "I’m looking for a stay in a different city than the ones listed in Explore stays.",
                    "",
                    "City (and area if any): ____",
                    "Check-in date: ____",
                    "Check-out date: ____",
                    "Guests & rooms: ____",
                    "",
                    "Approximate budget (per night or total): ____",
                    "",
                    "Special requests (if any): ____",
                    "",
                    "Contact name: ____",
                    "Mobile / WhatsApp: ____",
                    "",
                    "Please suggest the best options and rates available.",
                    "",
                    "Thank you!",
                  ].join("\n"),
                );
                window.location.href = `mailto:${encodeURIComponent(
                  BOOKING_EMAIL,
                )}?subject=${subject}&body=${body}`;
              }}
            >
              Prefer a different city? Ask our concierge
            </button>
          </div>

          {/* Property cards */}
          <div className="grid gap-3 md:grid-cols-3 text-xs md:text-sm">
            {visibleOptions.map((opt) => (
              <StayCard key={opt.id} option={opt} />
            ))}
          </div>
        </div>

        {/* Footer strip */}
        <div className="flex items-center justify-between gap-2 border-t px-6 py-3 text-[11px] text-slate-500 bg-slate-50/80">
          <span>
            You will receive a confirmation from our concierge team before any
            booking is final.
          </span>
          <span className="hidden sm:inline">
            Online one-tap booking · coming soon
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* Stay card with “Share details to book” → mailto:                          */
/* ------------------------------------------------------------------------- */

function StayCard({ option }: { option: StayOption }) {
  const { name, city, state, tagline, highlights, fromText, badge, vibe } =
    option;

  function handleShareDetailsClick() {
    const subject = `Booking enquiry – ${name}${
      city ? ` · ${city}` : ""
    } (via VAiyu)`;

    const bodyLines = [
      "Hi VAiyu concierge team,",
      "",
      `I'd like to enquire about booking: ${name}${
        city ? ` – ${city}, ${state}` : ""
      }.`,
      "",
      "My preferred dates:",
      "• Check-in date: ____",
      "• Check-out date: ____",
      "",
      "Guests & rooms:",
      "• Adults: ____    Children: ____",
      "• Rooms: ____",
      "",
      "Budget (per night or total): ____",
      "",
      "Any special requests (view, meals, transfers, early check-in / late check-out, etc.):",
      "____",
      "",
      "Contact details:",
      "• Full name: ____",
      "• Mobile / WhatsApp: ____",
      "",
      "Please confirm the best available rate and next steps.",
      "",
      "Thanks!",
    ];

    const mailto = `mailto:${encodeURIComponent(
      BOOKING_EMAIL,
    )}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      bodyLines.join("\n"),
    )}`;

    // Open default mail client
    window.location.href = mailto;
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="text-[11px] text-slate-500 mb-1">
        {city} · {state}
      </div>
      <div className="font-semibold text-slate-900 text-sm leading-snug">
        {name}
      </div>
      <div className="mt-1 text-[11px] text-emerald-700 font-medium">
        {tagline}
      </div>
      {vibe && (
        <div className="mt-0.5 text-[11px] text-slate-500">{vibe}</div>
      )}

      <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
        {highlights.map((h) => (
          <li key={h}>• {h}</li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-700">
        <div>
          <div className="font-semibold">{fromText}</div>
          <div className="text-[10px] text-slate-400">
            *Indicative rack rates. Final price will be confirmed on call.
          </div>
        </div>
        {badge && (
          <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700 border border-sky-100">
            {badge}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={handleShareDetailsClick}
        className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-3 py-2 text-[11px] font-medium text-white shadow-sm hover:bg-slate-800"
      >
        Share details to book
      </button>
    </div>
  );
}
