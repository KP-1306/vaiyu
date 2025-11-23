// web/src/components/rewards/RewardsWallet.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";

/** Types */
type HotelBalance = {
  hotel_id: string;
  hotel_name: string;
  city: string | null;
  cover_image_url: string | null;
  available_paise: number; // integer paise to avoid float math
  pending_paise: number;   // credits under review
};

type Voucher = {
  id: string;
  code: string;
  user_id: string;
  hotel_id: string;
  hotel_name?: string;
  amount_paise: number;
  status: "active" | "redeemed" | "expired" | "cancelled";
  expires_at: string | null;
  created_at: string;
};

/** New: optional props so this can be a full page OR a “stay wallet” pane */
export type RewardsWalletProps = {
  /** Default: "global" (full /rewards page). Use "stay" to show a single-property wallet. */
  context?: "global" | "stay";
  /** When context is "stay", pass the current stay’s hotel_id so we can focus that property. */
  hotelId?: string;
  /** Optional custom heading for stay view (otherwise "Your stay wallet"). */
  stayLabel?: string;
  /** Override whether to show the “Back to dashboard” button. Defaults:
   *  - global → true
   *  - stay   → false
   */
  showBackLink?: boolean;
};

/** Utils */
const inr = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const cx = (...xs: Array<string | false | undefined | null>) =>
  xs.filter(Boolean).join(" ");

/** Component */
export default function RewardsWallet({
  context = "global",
  hotelId,
  stayLabel,
  showBackLink,
}: RewardsWalletProps) {
  const isStayContext = context === "stay";
  const effectiveShowBackLink = showBackLink ?? !isStayContext;

  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<HotelBalance[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  // Claim modal
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimHotelId, setClaimHotelId] = useState<string>("");
  const [claimAmountPaise, setClaimAmountPaise] = useState<number>(0);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<Voucher | null>(null);

  // History modal
  const [historyOpen, setHistoryOpen] = useState(false);

  // Abort in-flight requests on unmount/route change
  const abortRef = useRef(new AbortController());
  useEffect(() => {
    return () => abortRef.current.abort();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    setNeedsAuth(false);

    try {
      // STEP 1: Session only
      const { data: sess, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const uid = sess.session?.user?.id;
      if (!uid) {
        // ✅ no session: show auth message and stop loading state
        setNeedsAuth(true);
        setLoading(false);
        return;
      }

      // STEP 2: Then data queries (only after we know we’re authed)
      const [overviewRes, vouchersRes] = await Promise.all([
        supabase
          .from("rewards_overview")
          .select("*")
          .order("hotel_name", { ascending: true })
          .throwOnError(),
        supabase
          .from("reward_vouchers_with_hotels")
          .select(
            "id, code, user_id, hotel_id, hotel_name, amount_paise, status, expires_at, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(50)
          .throwOnError(),
      ]);

      const obal = (overviewRes.data || []) as any[];
      setBalances(
        obal.map((r) => ({
          hotel_id: r.hotel_id,
          hotel_name: r.hotel_name,
          city: r.city ?? null,
          cover_image_url: r.cover_image_url ?? null,
          available_paise: r.available_paise ?? 0,
          pending_paise: r.pending_paise ?? 0,
        }))
      );

      setVouchers((vouchersRes.data || []) as Voucher[]);
    } catch (e: any) {
      console.error("[Rewards] load failed:", e);
      setError(e?.message || "Could not load rewards.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** New: in “stay” context we focus on a single property’s balance + vouchers */
  const balancesForDisplay = useMemo(() => {
    if (isStayContext && hotelId) {
      return balances.filter((b) => b.hotel_id === hotelId);
    }
    return balances;
  }, [balances, isStayContext, hotelId]);

  const totalAvailable = useMemo(
    () => balancesForDisplay.reduce((sum, b) => sum + b.available_paise, 0),
    [balancesForDisplay]
  );

  const vouchersForDisplay = useMemo(() => {
    if (isStayContext && hotelId) {
      return vouchers.filter((v) => v.hotel_id === hotelId);
    }
    return vouchers;
  }, [vouchers, isStayContext, hotelId]);

  /** Claim options:
   *  - global: all properties
   *  - stay: only the current property
   */
  const claimOptions = useMemo(() => {
    if (isStayContext && hotelId) {
      return balances.filter((b) => b.hotel_id === hotelId);
    }
    return balances;
  }, [balances, isStayContext, hotelId]);

  const heading = isStayContext
    ? stayLabel || "Your stay wallet"
    : "Your Rewards";
  const subheading = isStayContext
    ? "Credits and vouchers you can use at this property during your stay."
    : "Earn from referrals, redeem as vouchers at partner stays.";

  function openClaim(hotel_id: string) {
    const bal = balances.find((b) => b.hotel_id === hotel_id);
    if (!bal) return;
    setClaimHotelId(hotel_id);
    const min = 100 * 100; // ₹100
    const suggested = bal.available_paise >= min ? bal.available_paise : 0;
    setClaimAmountPaise(suggested);
    setClaimErr(null);
    setClaimSuccess(null);
    setClaimOpen(true);
  }

  // --- safer submit with validations + friendly overload error message ---
  async function submitClaim() {
    setClaimErr(null);
    setClaimBusy(true);
    setClaimSuccess(null);
    try {
      // Client-side validation
      if (!claimHotelId) throw new Error("Please select a hotel.");
      if (!Number.isFinite(claimAmountPaise)) throw new Error("Enter a valid amount.");
      if (claimAmountPaise <= 0) throw new Error("Enter a positive amount.");
      if (claimAmountPaise % 100 !== 0)
        throw new Error("Amount must be in whole rupees (no paise).");
      if (claimAmountPaise < 100 * 100)
        throw new Error("Minimum claim is ₹100.");

      const bal = balances.find((b) => b.hotel_id === claimHotelId);
      if (bal && claimAmountPaise > bal.available_paise) {
        throw new Error(
          `Amount exceeds available balance (${inr(b.available_paise)}).`
        );
      }

      // Try canonical alias first (if your DB created it), else fall back to claim_rewards
      let data: any | null = null;
      let err: any | null = null;

      // Optional alias to avoid overloaded function ambiguity
      const tryAlias = await supabase.rpc("claim_rewards_int8", {
        p_hotel_id: claimHotelId,
        p_amount_paise: claimAmountPaise, // JS number → Postgres int8 in alias
      });

      if (tryAlias.error && tryAlias.error.code !== "PGRST116") {
        // PGRST116: function not found (ignore and try default)
        err = tryAlias.error;
      } else if (tryAlias.data) {
        data = tryAlias.data;
      }

      if (!data && !err) {
        const res = await supabase.rpc("claim_rewards", {
          p_hotel_id: claimHotelId,
          p_amount_paise: claimAmountPaise,
        });
        data = res.data;
        err = res.error || null;
      }

      if (err) {
        const msg = String(err.message || err?.hint || err?.details || err);
        if (
          msg.includes("best candidate function") ||
          msg.includes("overloaded function")
        ) {
          throw new Error(
            "We couldn’t create the voucher because the server has two versions of ‘claim_rewards’. " +
              "Please keep a single version (prefer bigint/int8) or add an alias ‘claim_rewards_int8’. " +
              "Nothing was deducted."
          );
        }
        throw new Error(msg);
      }

      const v: Voucher = data as Voucher;
      setClaimSuccess(v);

      // Refresh balances + vouchers after claim
      await load();
    } catch (e: any) {
      console.error("[Rewards] claim failed:", e);
      setClaimErr(e?.message || "Could not create voucher. Please try again.");
    } finally {
      setClaimBusy(false);
    }
  }

  const selectedBalance = balances.find((b) => b.hotel_id === claimHotelId);
  const amountInvalid =
    !Number.isFinite(claimAmountPaise) ||
    claimAmountPaise < 100 * 100 ||
    claimAmountPaise % 100 !== 0 ||
    (selectedBalance ? claimAmountPaise > selectedBalance.available_paise : false);

  return (
    <main className="max-w-5xl mx-auto p-6">
      {/* Single navigation control — hidden by default in stay mode */}
      {effectiveShowBackLink && (
        <div className="mb-4">
          <Link to="/guest" className="btn btn-light">
            Back to dashboard
          </Link>
        </div>
      )}

      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="text-sm text-gray-600 mt-1">{subheading}</p>
        </div>
        <div className="rounded-xl border px-4 py-2 bg-white/90 shadow-sm text-right">
          <div className="text-xs text-gray-500">Available</div>
          <div className="text-xl font-semibold">{inr(totalAvailable)}</div>
        </div>
      </header>

      {needsAuth && !loading ? (
        <div className="mt-4 p-3 rounded-md bg-amber-50 text-amber-800 text-sm">
          Please sign in to view your rewards.{" "}
          <a className="underline" href="/signin">
            Go to sign in
          </a>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">
          {error}{" "}
          <button className="ml-2 underline" onClick={load}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid place-items-center min-h-[30vh]">Loading…</div>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {balancesForDisplay.length === 0 ? (
            <EmptyWallet />
          ) : (
            balancesForDisplay.map((b) => (
              <HotelCard
                key={b.hotel_id}
                b={b}
                onClaim={() => openClaim(b.hotel_id)}
              />
            ))
          )}
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-2 justify-end">
        <button className="btn btn-light" onClick={() => setHistoryOpen(true)}>
          View claim history
        </button>
      </div>

      {/* Claim Modal */}
      {claimOpen && (
        <div
          className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50"
          onClick={() => !claimBusy && setClaimOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Claim rewards</h2>

            <div className="mt-3 grid gap-3">
              <div>
                <label className="text-sm">Choose hotel</label>
                <select
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  value={claimHotelId}
                  onChange={(e) => {
                    setClaimHotelId(e.target.value);
                    setClaimErr(null);
                  }}
                  disabled={claimBusy}
                >
                  <option value="">Select</option>
                  {claimOptions.map((b) => (
                    <option key={b.hotel_id} value={b.hotel_id}>
                      {b.hotel_name} ({inr(b.available_paise)} available)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm">Amount to claim (₹)</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  type="number"
                  min={100}
                  step={1}
                  value={claimAmountPaise / 100}
                  onChange={(e) => {
                    const rupees = Math.max(0, Math.round(Number(e.target.value)));
                    setClaimAmountPaise(rupees * 100);
                    setClaimErr(null);
                  }}
                  disabled={claimBusy}
                />
                <p className="text-xs text-gray-600 mt-1">
                  Minimum ₹100. Whole rupees only.
                  {selectedBalance ? (
                    <>
                      {" "}
                      Available:{" "}
                      <span className="font-medium">
                        {inr(selectedBalance.available_paise)}
                      </span>
                    </>
                  ) : null}
                </p>
              </div>

              {claimErr ? <p className="text-sm text-red-600">{claimErr}</p> : null}
              {claimSuccess ? (
                <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm">
                  <div>
                    Voucher created:{" "}
                    <span className="font-medium">{claimSuccess.code}</span> for{" "}
                    <span className="font-medium">
                      {inr(claimSuccess.amount_paise)}
                    </span>
                  </div>
                  {claimSuccess.expires_at ? (
                    <div>
                      Expires on:{" "}
                      {new Date(claimSuccess.expires_at).toLocaleDateString()}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex gap-2 justify-end mt-2">
                <button
                  className="btn btn-light"
                  onClick={() => setClaimOpen(false)}
                  disabled={claimBusy}
                >
                  Close
                </button>
                <button
                  className="btn"
                  onClick={submitClaim}
                  disabled={claimBusy || !claimHotelId || amountInvalid}
                >
                  {claimBusy ? "Creating…" : "Create voucher"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyOpen && (
        <div
          className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50"
          onClick={() => setHistoryOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Claim history</h2>
              <button
                className="btn btn-light"
                onClick={() => setHistoryOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Hotel</th>
                    <th className="py-2 pr-3">Code</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {vouchersForDisplay.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-gray-500">
                        No vouchers yet.
                      </td>
                    </tr>
                  ) : (
                    vouchersForDisplay.map((v) => (
                      <tr key={v.id} className="border-t">
                        <td className="py-2 pr-3">
                          {new Date(v.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-2 pr-3">
                          {v.hotel_name || v.hotel_id}
                        </td>
                        <td className="py-2 pr-3 font-mono">{v.code}</td>
                        <td className="py-2 pr-3">{inr(v.amount_paise)}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={cx(
                              "px-2 py-0.5 rounded text-xs",
                              v.status === "active" &&
                                "bg-emerald-100 text-emerald-800",
                              v.status === "redeemed" &&
                                "bg-blue-100 text-blue-800",
                              v.status === "expired" &&
                                "bg-amber-100 text-amber-800",
                              v.status === "cancelled" &&
                                "bg-gray-200 text-gray-700"
                            )}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          {v.expires_at
                            ? new Date(v.expires_at).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Subcomponents */
function HotelCard({ b, onClaim }: { b: HotelBalance; onClaim: () => void }) {
  return (
    <div className="rounded-2xl border bg-white/90 shadow-sm overflow-hidden flex">
      {b.cover_image_url ? (
        <img
          src={b.cover_image_url}
          alt=""
          className="w-32 h-32 object-cover hidden sm:block"
        />
      ) : (
        <div className="w-32 h-32 hidden sm:block bg-gradient-to-br from-slate-100 to-slate-200" />
      )}
      <div className="flex-1 p-4 grid content-between">
        <div>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{b.hotel_name}</h3>
            <span className="text-xs text-gray-500">{b.city || ""}</span>
          </div>
          <div className="mt-2 flex items-center gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">Available</div>
              <div className="font-semibold">{inr(b.available_paise)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Pending</div>
              <div className="font-semibold">{inr(b.pending_paise)}</div>
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            className="btn"
            disabled={b.available_paise < 100 * 100}
            onClick={onClaim}
          >
            {b.available_paise < 100 * 100 ? "Need ₹100+" : "Claim rewards"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyWallet() {
  return (
    <div className="rounded-2xl border bg-white/90 shadow-sm p-8 text-center md:col-span-2">
      <p className="text-sm text-gray-600">
        No credits yet. Invite a friend to a partner hotel to start earning.
      </p>
      <div className="mt-3">
        <Link className="btn" to="/invite">
          Invite & earn
        </Link>
      </div>
    </div>
  );
}
