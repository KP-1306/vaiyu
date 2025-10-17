import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

const INTRO_VERSION = "v3"; // bump when you change the content/design
const STORAGE_KEY = `guest:intro:${INTRO_VERSION}`;

export default function WelcomeExperience() {
  const [show, setShow] = useState(false);
  const [firstName, setFirstName] = useState<string>("");

  // show if this version hasn't been dismissed yet
  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) setShow(true);
  }, []);

  // pull the user's first name (email fallback)
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!mounted) return;
      const n =
        (data?.user?.user_metadata?.full_name as string | undefined) ||
        (data?.user?.user_metadata?.name as string | undefined) ||
        (data?.user?.email as string | undefined) ||
        "there";
      setFirstName(n.split(" ")[0]);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, "1");
    setShow(false);
  }

  if (!show) return null;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border bg-white p-5 shadow-sm"
      role="region"
      aria-label="Welcome"
    >
      {/* soft gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-50/60 via-transparent to-indigo-50/70" />

      <div className="relative z-10 flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-white px-2.5 py-1 text-xs text-gray-600 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Welcome
          </div>
          <h2 className="mt-2 text-xl font-semibold">
            Hi {firstName}, here’s what you can do with VAiyu
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Scan to check-in, track bills, add reviews, and more—right from your phone.
          </p>
        </div>

        <button
          onClick={dismiss}
          className="rounded-lg border bg-white px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          aria-label="Dismiss introduction"
        >
          Got it
        </button>
      </div>

      {/* action tiles */}
      <div className="relative z-10 mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          title="Scan & check-in"
          desc="Arrived at the hotel? Scan the front-desk QR to fetch your booking and start check-in."
          cta={{ to: "/guest#checkin", label: "Open scanner" }}
          icon={<PhoneQrIcon />}
        />

        <Tile
          title="Enter booking code"
          desc="Don’t have the QR handy? Paste your booking code to pull up your stay."
          cta={{ to: "/guest#code", label: "Enter code" }}
          icon={<KeyIcon />}
        />

        <Tile
          title="Bills & receipts"
          desc="Download tax invoices or expense receipts for past stays in seconds."
          cta={{ to: "/bills", label: "Download bills" }}
          icon={<ReceiptIcon />}
        />

        <Tile
          title="Your profile"
          desc="Add your name and phone once—auto-fill across every property."
          cta={{ to: "/profile", label: "Update profile" }}
          icon={<UserIcon />}
        />

        <Tile
          title="Your reviews"
          desc="Keep your feedback. Edit context anytime and see AI-drafted summaries."
          cta={{ to: "/reviews/mine", label: "Manage reviews" }}
          icon={<StarIcon />}
        />

        <Tile
          title="Run a property?"
          desc="Unlock the owner console for dashboards, SLAs, workflows and brand safety."
          cta={{ to: "/owner/register", label: "Register property" }}
          icon={<BuildingIcon />}
        />
      </div>
    </section>
  );
}

function Tile({
  title,
  desc,
  cta,
  icon,
}: {
  title: string;
  desc: string;
  cta: { to: string; label: string };
  icon: React.ReactNode;
}) {
  return (
    <div className="group rounded-xl border bg-white p-4 shadow-sm transition hover:shadow">
      <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
        {icon}
      </div>
      <div className="font-medium">{title}</div>
      <div className="mt-1 text-sm text-gray-600">{desc}</div>
      <div className="mt-3">
        <Link to={cta.to} className="btn btn-light btn-sm">
          {cta.label} →
        </Link>
      </div>
    </div>
  );
}

/* --- tiny inline icons (no extra deps) --- */
function PhoneQrIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <rect x="9" y="6" width="6" height="6" rx="1" />
      <path d="M9 17h6" />
    </svg>
  );
}
function KeyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
      <circle cx="8.5" cy="8.5" r="4" />
      <path d="M12 12l8 8m-5-3l3 3" />
    </svg>
  );
}
function ReceiptIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
      <path d="M7 3h10v18l-3-2-2 2-2-2-3 2V3z" />
      <path d="M9 7h6M9 10h6M9 13h6" />
    </svg>
  );
}
function UserIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c2-4 14-4 16 0" />
    </svg>
  );
}
function StarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
      <path d="M12 17l-5.5 3 1.5-6.3L3 9.5l6.2-.5L12 3l2.8 6 6.2.5-5 4.2 1.5 6.3z" />
    </svg>
  );
}
function BuildingIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
      <rect x="4" y="3" width="10" height="18" rx="2" />
      <path d="M14 7h6v14H8" />
      <path d="M7 7h4M7 11h4M7 15h4" />
    </svg>
  );
}
