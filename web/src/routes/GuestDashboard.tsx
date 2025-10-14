// web/src/routes/GuestDashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { myStays, myCredits, referralInit } from "../lib/api";
import SEO from "../components/SEO";

const TOKEN_KEY = "stay:token";

type Stay = {
  code: string;
  status: "upcoming" | "active" | "completed";
  hotel_slug?: string;
  hotel_name?: string;
  check_in?: string;
  check_out?: string;
};

type Credit = {
  property: string;
  balance: number;
  currency?: string;
  expiresAt?: string | null;
};

<SEO title="Owner Home" noIndex />

export default function GuestDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stays, setStays] = useState<Stay[]>([]);
  const [err, setErr] = useState<string>("");
  const [credits, setCredits] = useState<Record<string, Credit>>({});
  const [refLinks, setRefLinks] = useState<Record<string, string>>({});
  const [busyProp, setBusyProp] = useState<string | null>(null);

  const token = useMemo(() => localStorage.getItem(TOKEN_KEY) ?? "", []);

  useEffect(() => {
    if (!token) {
      navigate("/claim", { replace: true });
      return;
    }

    (async () => {
      setLoading(true);
      setErr("");
      try {
        // 1) Stays
        const res = await myStays(token);
        const list = res?.stays ?? [];
        setStays(list);

        // 2) Credits (non-blocking)
        try {
          const c = await myCredits(token);
          const map: Record<string, Credit> = {};
          (c?.items ?? []).forEach((it: Credit) => (map[it.property] = it));
          setCredits(map);
        } catch {
          /* ignore; credit fetch is optional */
        }
      } catch (e: any) {
        const msg = e?.message || "Failed to load your stays.";
        setErr(msg);
        if (/unauth|forbidden|401|403/i.test(String(e))) {
          localStorage.removeItem(TOKEN_KEY);
          navigate("/claim", { replace: true });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, token]);

  async function onGetReferral(property?: string) {
    if (!property) return;
    try {
      setBusyProp(property);
      const r = await referralInit(property, token || undefined, "guest_dashboard");
      const url =
        r?.shareUrl ||
        (r?.code
          ? `${location.origin}/hotel/${property}?ref=${encodeURIComponent(r.code)}`
          : "");

      if (url) {
        setRefLinks((p) => ({ ...p, [property]: url }));
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          /* ignore clipboard errors */
        }
      }
    } finally {
      setBusyProp(null);
    }
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    navigate("/claim", { replace: true });
  }

  if (!token) return null;

  return (
    <main className="max-w-3xl mx-auto p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Your stays</h1>
        <div className="flex gap-2">
          <Link to="/claim" className="btn btn-light">
            Claim another booking
          </Link>
          <button className="btn btn-outline" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-3 p-2 rounded border border-amber-300 bg-amber-50 text-amber-800">
          {err}
        </div>
      )}

      {loading && <SkeletonList />}

      {!loading && !stays.length && !err && (
        <div className="card">
          <div className="font-medium">No stays yet</div>
          <div className="text-sm text-gray-600 mt-1">
            If you booked on another platform, you can link it here.
          </div>
          <div className="mt-3">
            <Link to="/claim" className="btn">
              Claim a booking
            </Link>
          </div>
        </div>
      )}

      {!loading && !!stays.length && (
        <ul className="grid gap-3">
          {stays.map((s) => {
            const property = s.hotel_slug;
            const credit = property ? credits[property] : undefined;
            const refUrl = property ? refLinks[property] : undefined;
            const currency = credit?.currency || "INR";

            return (
              <li key={s.code} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-500">
                      {s.hotel_name || s.hotel_slug || "—"}
                    </div>
                    <div className="font-semibold mt-0.5">Booking {s.code}</div>
                    <div className="text-xs text-gray-500 mt-1 capitalize">{s.status}</div>
                    {(s.check_in || s.check_out) && (
                      <div className="text-xs text-gray-500 mt-1">
                        {s.check_in ? `Check-in: ${formatDate(s.check_in)}` : ""}
                        {s.check_in && s.check_out ? " · " : ""}
                        {s.check_out ? `Check-out: ${formatDate(s.check_out)}` : ""}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 justify-end">
                    {s.status !== "completed" && (
                      <Link
                        to={`/stay/${encodeURIComponent(s.code)}/menu`}
                        className="btn"
                      >
                        Open guest menu
                      </Link>
                    )}
                    {s.status === "upcoming" && (
                      <Link
                        to={`/precheck/${encodeURIComponent(s.code)}`}
                        className="btn btn-light"
                      >
                        Pre-check-in
                      </Link>
                    )}
                    {s.status !== "upcoming" && (
                      <Link
                        to={`/stay/${encodeURIComponent(s.code)}/bill`}
                        className="btn btn-light"
                      >
                        View bill
                      </Link>
                    )}
                  </div>
                </div>

                {/* Credits + Refer & earn */}
                {property && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded border p-3 bg-gray-50">
                      <div className="text-[11px] text-gray-500">Credits (property-scoped)</div>
                      <div className="font-medium">
                        {formatCurrency(credit?.balance ?? 0, currency)}
                        {credit?.expiresAt && (
                          <span className="text-xs text-gray-500">
                            {" "}
                            · exp {formatDate(credit.expiresAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded border p-3 bg-white">
                      <div className="text-[11px] text-gray-500">Refer &amp; earn</div>

                      {!refUrl ? (
                        <button
                          className="btn btn-light mt-1"
                          disabled={busyProp === property}
                          onClick={() => onGetReferral(property)}
                        >
                          {busyProp === property ? "Generating…" : "Get referral link"}
                        </button>
                      ) : (
                        <div className="text-xs mt-1">
                          <div className="break-all">{refUrl}</div>
                          <div className="mt-1 flex gap-2">
                            <button
                              className="btn btn-light"
                              onClick={() => {
                                try {
                                  navigator.clipboard.writeText(refUrl);
                                } catch {
                                  /* ignore */
                                }
                              }}
                            >
                              Copy
                            </button>
                            <a
                              className="btn btn-light"
                              target="_blank"
                              rel="noreferrer"
                              href={`https://wa.me/?text=${encodeURIComponent(refUrl)}`}
                            >
                              Share
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/* ---------------- helpers ---------------- */

function formatDate(iso?: string) {
  try {
    return iso ? new Date(iso).toLocaleDateString() : "";
  } catch {
    return iso || "";
  }
}

function formatCurrency(amount: number, currency = "INR") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // Fallback if Intl doesn't know the currency
    const symbol = currency === "INR" ? "₹" : "";
    return `${symbol}${amount.toString()}`;
  }
}

function SkeletonList() {
  return (
    <ul className="grid gap-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="card">
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-40 bg-gray-200 rounded" />
            <div className="h-5 w-56 bg-gray-200 rounded" />
            <div className="h-3 w-28 bg-gray-200 rounded" />
            <div className="h-8 w-40 bg-gray-200 rounded mt-2" />
          </div>
        </li>
      ))}
    </ul>
  );
}
