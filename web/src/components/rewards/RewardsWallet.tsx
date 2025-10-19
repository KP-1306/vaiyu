import { useEffect, useMemo, useState } from "react";
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

/** Utils */
const inr = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const cx = (...xs: Array<string | false | undefined | null>) => xs.filter(Boolean).join(" ");

/** Component */
export default function RewardsWallet() {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<HotelBalance[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Claim modal
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimHotelId, setClaimHotelId] = useState<string>("");
  const [claimAmountPaise, setClaimAmountPaise] = useState<number>(0);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<Voucher | null>(null);

  // History modal
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ data: sess }, overviewRes, vouchersRes] = await Promise.all([
          supabase.auth.getSession(),
          supabase.from("rewards_overview").select("*").order("hotel_name", { ascending: true }),
          supabase
            .from("reward_vouchers_with_hotels")
            .select("id, code, user_id, hotel_id, hotel_name, amount_paise, status, expires_at, created_at")
            .order("created_at", { ascending: false })
            .limit(50),
        ]);

        const uid = sess.session?.user?.id;
        if (!uid) throw new Error("Please sign in to view rewards.");

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
        setError(e?.message || "Could not load rewards.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totalAvailable = useMemo(
    () => balances.reduce((sum, b) => sum + b.available_paise, 0),
    [balances]
  );

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

  async function submitClaim() {
    setClaimErr(null);
    setClaimBusy(true);
    setClaimSuccess(null);
    try {
      if (!claimHotelId) throw new Error("Choose a hotel.");
      if (claimAmountPaise <= 0) throw new Error("Enter a positive amount.");
      if (claimAmountPaise % 100 !== 0) throw new Error("Amount must be in whole rupees (no paise).");
      if (claimAmountPaise < 100 * 100) throw new Error("Minimum claim is ₹100.");

      // Transactional RPC on the DB (prevents double-spend)
      const { data, error } = await supabase.rpc("claim_rewards", {
        p_hotel_id: claimHotelId,
        p_amount_paise: claimAmountPaise,
      });
      if (error) throw error;

      const v: Voucher = data;
      setClaimSuccess(v);

      // Refresh balances + vouchers
      const [overviewRes, vouchersRes] = await Promise.all([
        supabase.from("rewards_overview").select("*").order("hotel_name", { ascending: true }),
        supabase
          .from("reward_vouchers_with_hotels")
          .select("id, code, user_id, hotel_id, hotel_name, amount_paise, status, expires_at, created_at")
          .order("created_at", { ascending: false })
          .limit(50),
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
      setClaimErr(e?.message || "Could not create voucher.");
    } finally {
      setClaimBusy(false);
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your Rewards</h1>
          <p className="text-sm text-gray-600 mt-1">
            Earn from referrals, redeem as vouchers at partner stays.
          </p>
        </div>
        <div className="rounded-xl border px-4 py-2 bg-white/90 shadow-sm text-right">
          <div className="text-xs text-gray-500">Available</div>
          <div className="text-xl font-semibold">{inr(totalAvailable)}</div>
        </div>
      </header>

      {error ? (
        <div className="mt-4 p-3 rounded-md bg-red-50 text-red-700 text-sm">{error}</div>
      ) : null}

      {loading ? (
        <div className="grid place-items-center min-h-[30vh]">Loading…</div>
      ) : (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {balances.length === 0 ? (
            <EmptyWallet />
          ) : (
            balances.map((b) => (
              <HotelCard key={b.hotel_id} b={b} onClaim={() => openClaim(b.hotel_id)} />
            ))
          )}
        </section>
      )}

      <div className="mt-6 flex justify-end">
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
                  onChange={(e) => setClaimHotelId(e.target.value)}
                  disabled={claimBusy}
                >
                  <option value="">Select</option>
                  {balances.map((b) => (
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
                  onChange={(e) =>
                    setClaimAmountPaise(Math.max(0, Math.round(Number(e.target.value) * 100)))
                  }
                  disabled={claimBusy}
                />
                <p className="text-xs text-gray-600 mt-1">Minimum ₹100. Whole rupees only.</p>
              </div>

              {claimErr ? <p className="text-sm text-red-600">{claimErr}</p> : null}
              {claimSuccess ? (
                <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm">
                  <div>
                    Voucher created: <span className="font-medium">{claimSuccess.code}</span> for{" "}
                    <span className="font-medium">{inr(claimSuccess.amount_paise)}</span>
                  </div>
                  {claimSuccess.expires_at ? (
                    <div>Expires on: {new Date(claimSuccess.expires_at).toLocaleDateString()}</div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex gap-2 justify-end mt-2">
                <button className="btn btn-light" onClick={() => setClaimOpen(false)} disabled={claimBusy}>
                  Close
                </button>
                <button className="btn" onClick={submitClaim} disabled={claimBusy}>
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
              <button className="btn btn-light" onClick={() => setHistoryOpen(false)}>
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
                  {vouchers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-gray-500">
                        No vouchers yet.
                      </td>
                    </tr>
                  ) : (
                    vouchers.map((v) => (
                      <tr key={v.id} className="border-t">
                        <td className="py-2 pr-3">{new Date(v.created_at).toLocaleDateString()}</td>
                        <td className="py-2 pr-3">{v.hotel_name || v.hotel_id}</td>
                        <td className="py-2 pr-3 font-mono">{v.code}</td>
                        <td className="py-2 pr-3">{inr(v.amount_paise)}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={cx(
                              "px-2 py-0.5 rounded text-xs",
                              v.status === "active" && "bg-emerald-100 text-emerald-800",
                              v.status === "redeemed" && "bg-blue-100 text-blue-800",
                              v.status === "expired" && "bg-amber-100 text-amber-800",
                              v.status === "cancelled" && "bg-gray-200 text-gray-700"
                            )}
                          >
                            {v.status}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          {v.expires_at ? new Date(v.expires_at).toLocaleDateString() : "—"}
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
        <img src={b.cover_image_url} alt="" className="w-32 h-32 object-cover hidden sm:block" />
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
          <button className="btn" disabled={b.available_paise < 100 * 100} onClick={onClaim}>
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
        <a className="btn" href="/invite">
          Invite & earn
        </a>
      </div>
    </div>
  );
}
