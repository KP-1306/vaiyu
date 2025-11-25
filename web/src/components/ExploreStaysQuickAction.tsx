// web/src/components/ExploreStaysQuickAction.tsx
import { useMemo, useState } from "react";

type Props = {
  /** Optional extra classes for the small trigger button/link */
  className?: string;
};

/**
 * ExploreStaysQuickAction
 *
 * Replaces the old "Book a new stay" link in the Guest Dashboard quick-actions.
 * Instead of sending guests to the public landing page, this opens a premium
 * concierge-style panel where they can share basic trip details. We then
 * prepare a mail / WhatsApp message for offline booking support.
 */
export default function ExploreStaysQuickAction({ className = "" }: Props) {
  const [open, setOpen] = useState(false);

  // Simple form state
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState("2");
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");

  const disabled = !city.trim() || !checkIn || !checkOut;

  // Build a nice booking request summary for email / WhatsApp
  const requestSummary = useMemo(() => {
    if (disabled) return "";
    const parts: string[] = [];
    parts.push(`City / Destination: ${city.trim()}`);
    parts.push(`Check-in: ${checkIn}`);
    parts.push(`Check-out: ${checkOut}`);
    if (guests) parts.push(`Guests: ${guests}`);
    if (budget) parts.push(`Nightly budget: ${budget}`);
    if (notes.trim()) parts.push(`Preferences / Notes: ${notes.trim()}`);
    return parts.join("\n");
  }, [city, checkIn, checkOut, guests, budget, notes, disabled]);

  function handleSendEmail() {
    if (disabled) return;
    const subject = encodeURIComponent("New booking request via VAiyu guest dashboard");
    const body = encodeURIComponent(
      `Hi VAiyu team,\n\nI'd like help booking a new stay. Here are my details:\n\n${requestSummary}\n\nPlease share the best options and confirmation.\n\nThank you!`
    );
    window.location.href = `mailto:support@vaiyu.co.in?subject=${subject}&body=${body}`;
  }

  function handleSendWhatsApp() {
    if (disabled) return;
    // NOTE: if you later have a dedicated concierge number, replace this with it.
    const text = encodeURIComponent(
      `New booking request via VAiyu guest dashboard:\n\n${requestSummary}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      {/* Trigger – looks like a subtle link inside the quick action card */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline ${className}`}
      >
        Book a new stay
        <span aria-hidden>↗</span>
      </button>

      {/* Lightweight overlay panel */}
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-3 py-6"
          aria-modal="true"
          role="dialog"
        >
          <div className="relative w-full max-w-lg rounded-2xl bg-white/95 p-5 shadow-2xl">
            {/* Close */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-3 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              ✕
            </button>

            <div className="mb-3 space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                <span>New</span>
                <span className="h-1 w-1 rounded-full bg-blue-500" />
                <span>Concierge booking</span>
              </div>
              <h2 className="text-lg font-semibold">
                Tell us where you want to stay
              </h2>
              <p className="text-xs text-slate-600">
                We&apos;re rolling out instant online booking soon. For now, share a
                few details and our team will help you book the best VAiyu partner
                property and send a confirmation over email or WhatsApp.
              </p>
            </div>

            {/* Form */}
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="City / destination *"
                  placeholder="Jaipur, Nainital, Goa…"
                  value={city}
                  onChange={setCity}
                />
                <Field
                  label="Guests"
                  placeholder="2"
                  value={guests}
                  onChange={setGuests}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Check-in *"
                  type="date"
                  value={checkIn}
                  onChange={setCheckIn}
                />
                <Field
                  label="Check-out *"
                  type="date"
                  value={checkOut}
                  onChange={setCheckOut}
                />
              </div>

              <Field
                label="Budget per night (optional)"
                placeholder="₹4,000 – ₹6,000"
                value={budget}
                onChange={setBudget}
              />

              <TextArea
                label="Preferences / notes (optional)"
                placeholder="Room type, view preference, occasion (birthday, anniversary), etc."
                value={notes}
                onChange={setNotes}
              />

              <p className="text-[11px] text-slate-500">
                By sending a request, you agree that our team may contact you on your
                registered email / phone number to confirm the booking. Payment and
                final confirmation will be shared securely.
              </p>

              {/* Actions */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSendEmail}
                  disabled={disabled}
                  className={`btn btn-sm ${
                    disabled ? "cursor-not-allowed opacity-60" : ""
                  }`}
                >
                  Request via email
                </button>
                <button
                  type="button"
                  onClick={handleSendWhatsApp}
                  disabled={disabled}
                  className={`btn btn-light btn-sm ${
                    disabled ? "cursor-not-allowed opacity-60" : ""
                  }`}
                >
                  Request on WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn btn-ghost btn-sm ml-auto text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Small internal UI helpers ---------- */

type FieldProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: FieldProps) {
  return (
    <label className="grid gap-1 text-xs text-slate-700">
      <span>{label}</span>
      <input
        type={type}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

type TextAreaProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

function TextArea({ label, value, onChange, placeholder }: TextAreaProps) {
  return (
    <label className="grid gap-1 text-xs text-slate-700">
      <span>{label}</span>
      <textarea
        className="min-h-[80px] rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
