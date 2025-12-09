// web/src/routes/Checkout.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { API } from "../lib/api";

/**
 * Robust query param reader
 */
function qp(locationSearch: string) {
  return new URLSearchParams(locationSearch || "");
}

function pickFirst(sp: URLSearchParams, keys: string[]) {
  for (const k of keys) {
    const v = sp.get(k);
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

/**
 * Try to read a stay/claim token from localStorage with multiple safe keys.
 * We don't block the user purely based on this,
 * but it helps keep legacy flows working.
 */
function readStayToken(code?: string) {
  if (typeof localStorage === "undefined") return "";
  const c = (code || "").trim().toUpperCase();

  const keys = [
    "vaiyu.stay.token",
    "vaiyu.stayToken",
    "stay_token",
    "stayToken",
    "vaiyu.claim.token",
    "claim_token",
    c ? `vaiyu.stay.${c}.token` : "",
    c ? `stay:${c}:token` : "",
  ].filter(Boolean);

  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v && v.trim()) return v.trim();
  }
  return "";
}

type CreditBalance = {
  property: string;
  balance: number;
  currency?: string;
  expiresAt?: string | null;
};

function clamp(n: number, min = 0, max = Number.POSITIVE_INFINITY) {
  return Math.max(min, Math.min(max, n));
}

export default function Checkout() {
  const location = useLocation();
  const navigate = useNavigate();

  const sp = useMemo(() => qp(location.search), [location.search]);

  const bookingCodeFromQP = useMemo(() => {
    const raw =
      pickFirst(sp, [
        "bookingCode",
        "booking_code",
        "code",
        "stayCode",
        "stay_code",
      ]) || "";
    return raw.trim().toUpperCase();
  }, [sp]);

  const hotelIdFromQP = useMemo(
    () => pickFirst(sp, ["hotelId", "hotel_id", "propertyId", "property_id"]),
    [sp]
  );

  const propertySlugFromQP = useMemo(
    () =>
      pickFirst(sp, [
        "propertySlug",
        "property_slug",
        "hotelSlug",
        "hotel_slug",
        "property",
        "slug",
      ]),
    [sp]
  );

  const from = sp.get("from") || "";

  const [bookingCode] = useState<string>(bookingCodeFromQP);
  const [propertySlug, setPropertySlug] = useState<string>(
    propertySlugFromQP || ""
  );
  const [propertyLocked, setPropertyLocked] = useState<boolean>(
    !!propertySlugFromQP
  );

  const [credits, setCredits] = useState<CreditBalance[]>([]);
  const [loadingCredits, setLoadingCredits] = useState(false);

  const [amount, setAmount] = useState<number>(0);
  const [applyMsg, setApplyMsg] = useState<string>("");
  const [finishMsg, setFinishMsg] = useState<string>("");

  const [consentReviews, setConsentReviews] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);

  const didInitRef = useRef(false);

  /**
   * Resolve property slug:
   * 1) QP propertySlug/hotelSlug
   * 2) hotelId -> supabase hotels lookup
   * 3) optional API fallback if you have it
   */
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    async function resolveSlug() {
      // 1) if QP already has it
      if (propertySlugFromQP) {
        setPropertySlug(propertySlugFromQP);
        setPropertyLocked(true);
        return;
      }

      // 2) if hotelId is present, resolve via Supabase
      if (hotelIdFromQP) {
        try {
          const { data, error } = await supabase
            .from("hotels")
            .select("slug")
            .eq("id", hotelIdFromQP)
            .maybeSingle();

          if (!error && data?.slug) {
            setPropertySlug(String(data.slug));
            setPropertyLocked(true);
            return;
          }
        } catch {
          // ignore and fallback
        }
      }

      // 3) Optional: if your API layer has helpers, try them
      try {
        const anyAPI = API as any;

        if (
          bookingCodeFromQP &&
          typeof anyAPI.getPropertySlugForBooking === "function"
        ) {
          const slug = await anyAPI.getPropertySlugForBooking(
            bookingCodeFromQP
          );
          if (slug) {
            setPropertySlug(String(slug));
            setPropertyLocked(true);
            return;
          }
        }

        if (
          bookingCodeFromQP &&
          typeof anyAPI.getStayByCode === "function"
        ) {
          const stay = await anyAPI.getStayByCode(bookingCodeFromQP);
          const slug =
            stay?.hotel_slug ??
            stay?.hotelSlug ??
            stay?.property_slug ??
            stay?.propertySlug;
          if (slug) {
            setPropertySlug(String(slug));
            setPropertyLocked(true);
            return;
          }
        }
      } catch {
        // ignore
      }

      // final: leave editable but empty
      setPropertyLocked(false);
    }

    resolveSlug();
  }, [bookingCodeFromQP, hotelIdFromQP, propertySlugFromQP]);

  /**
   * Load credits (if API supports it).
   */
  useEffect(() => {
    let alive = true;
    async function loadCredits() {
      const anyAPI = API as any;
      if (typeof anyAPI.myCredits !== "function") return;

      setLoadingCredits(true);
      try {
        const res = await anyAPI.myCredits();
        const items = (res?.items ?? res ?? []) as CreditBalance[];
        if (alive) setCredits(Array.isArray(items) ? items : []);
      } catch {
        if (alive) setCredits([]);
      } finally {
        if (alive) setLoadingCredits(false);
      }
    }
    loadCredits();
    return () => {
      alive = false;
    };
  }, []);

  const availableForProperty = useMemo(() => {
    const slug = (propertySlug || "").trim();
    if (!slug) return 0;
    const hit = credits.find((c) => c.property === slug);
    return Math.max(0, Number(hit?.balance ?? 0) || 0);
  }, [credits, propertySlug]);

  function onAmountChange(v: string) {
    const n = Math.max(0, Number(v) || 0);
    const safe = clamp(n, 0, availableForProperty || n);
    setAmount(safe);
    setApplyMsg("");
  }

  async function handleApplyCredits() {
    setApplyMsg("");

    const slug = (propertySlug || "").trim();
    if (!bookingCode) {
      setApplyMsg("⚠️ Booking code is missing.");
      return;
    }
    if (!slug) {
      setApplyMsg("⚠️ Property slug is missing.");
      return;
    }
    if (amount <= 0) {
      setApplyMsg("⚠️ Enter a valid amount.");
      return;
    }

    const stayToken = readStayToken(bookingCode);

    try {
      const anyAPI = API as any;

      if (typeof anyAPI.redeemCredits === "function") {
        let res: any;

        try {
          res = await anyAPI.redeemCredits(stayToken, slug, amount, {
            bookingCode,
            from: "checkout",
          });
        } catch {
          res = await anyAPI.redeemCredits(slug, amount, {
            bookingCode,
            from: "checkout",
          });
        }

        const applied =
          Number(res?.applied ?? res?.amount ?? amount) || amount;

        setApplyMsg(`✅ Applied ₹${applied} credits.`);
        setCredits((prev) =>
          prev.map((c) =>
            c.property === slug
              ? { ...c, balance: Math.max(0, (c.balance || 0) - applied) }
              : c
          )
        );
        setAmount(0);
        return;
      }

      setApplyMsg("⚠️ Credits API is not available in this build.");
    } catch (e: any) {
      const msg = String(e?.message || "");
      if (msg.toLowerCase().includes("claim")) {
        setApplyMsg(
          "⚠️ Your stay session is missing. Please claim your booking first, then try applying credits."
        );
      } else {
        setApplyMsg(`⚠️ Could not apply credits. ${msg}`);
      }
    }
  }

  async function handleFinish() {
    setFinishMsg("");

    if (!bookingCode) {
      setFinishMsg("⚠️ Booking code is missing.");
      return;
    }

    try {
      const anyAPI = API as any;

      if (typeof anyAPI.setBookingConsent === "function") {
        try {
          await anyAPI.setBookingConsent(bookingCode, !!consentReviews);
        } catch {
          // non-fatal
        }
      }

      if (typeof anyAPI.checkout === "function") {
        await anyAPI.checkout({
          bookingCode,
          code: bookingCode,
          autopost: autoPublish,
          propertySlug: propertySlug || undefined,
          hotelId: hotelIdFromQP || undefined,
        });
      } else if (typeof anyAPI.endStay === "function") {
        await anyAPI.endStay(bookingCode, autoPublish);
      }

      setFinishMsg("✅ Checkout completed. Thank you for staying with us!");

      if (from === "stay") {
        navigate(`/stay/${encodeURIComponent(bookingCode)}`);
      } else {
        navigate("/guest");
      }
    } catch (e: any) {
      setFinishMsg(`⚠️ Checkout failed. ${String(e?.message || "")}`);
    }
  }

  // Simple “happy stay” message variants (no randomness across renders)
  const farewell = useMemo(() => {
    if (!bookingCode) return "Thank you for choosing us.";
    return "We hope your stay was restful, easy, and full of good moments.";
  }, [bookingCode]);

  return (
    <div
      className="page checkout-page"
      style={{
        background:
          "linear-gradient(180deg, rgba(20,90,242,0.06), rgba(20,90,242,0.0) 40%), linear-gradient(120deg, rgba(16,185,129,0.06), rgba(16,185,129,0.0) 35%)",
      }}
    >
      <div
        className="page-inner"
        style={{
          maxWidth: 1080,
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 18,
        }}
      >
        {/* Responsive two-column on wider screens */}
        <style>{`
          @media (min-width: 900px) {
            .checkout-grid {
              grid-template-columns: 1.05fr 0.95fr !important;
              align-items: start;
            }
          }
          .premium-card {
            border-radius: 16px;
            border: 1px solid rgba(0,0,0,0.06);
            background: white;
            box-shadow: 0 10px 30px rgba(0,0,0,0.06);
          }
          .premium-soft {
            border-radius: 16px;
            border: 1px solid rgba(0,0,0,0.04);
            background: linear-gradient(135deg, rgba(20,90,242,0.10), rgba(16,185,129,0.08));
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.35);
          }
          .muted-mini {
            opacity: 0.75;
            font-size: 12px;
          }
          .pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(0,0,0,0.05);
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.2px;
          }
          .hero-emoji {
            font-size: 30px;
            line-height: 1;
          }
          .checkout-kicker {
            font-size: 11px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            opacity: 0.65;
            font-weight: 700;
          }
          .checkout-title {
            font-size: 28px;
            font-weight: 800;
            margin: 6px 0 8px;
          }
          .checkout-sub {
            opacity: 0.85;
            line-height: 1.45;
          }
          .info-row {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
          }
          .info-chip {
            background: rgba(255,255,255,0.65);
            border: 1px solid rgba(0,0,0,0.06);
            padding: 8px 10px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 600;
          }
          .credits-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 10px;
            background: rgba(16,185,129,0.10);
            border: 1px solid rgba(16,185,129,0.20);
            font-size: 11px;
            font-weight: 700;
          }
          .btn-primary-premium {
            background: linear-gradient(90deg, #145AF2, #0EA5E9);
            color: white;
            border: none;
          }
          .btn-primary-premium:disabled {
            opacity: 0.55;
          }
        `}</style>

        <div className="checkout-grid" style={{ display: "grid", gap: 18 }}>
          {/* Left: Premium farewell / delight panel */}
          <div className="premium-soft" style={{ padding: 22 }}>
            <div className="pill">
              <span className="hero-emoji">✨</span>
              <span>Checkout &amp; Farewell</span>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="checkout-kicker">Thank you</div>
              <div className="checkout-title">We loved hosting you</div>
              <div className="checkout-sub">{farewell}</div>
            </div>

            <div className="info-row">
              <div className="info-chip">
                Booking code: <strong>{bookingCode || "—"}</strong>
              </div>
              <div className="info-chip">
                Property: <strong>{propertySlug || "—"}</strong>
              </div>
              <div className="info-chip">
                Credits available:{" "}
                <strong>
                  {loadingCredits ? "…" : `₹${availableForProperty}`}
                </strong>
              </div>
            </div>

            <div
              className="premium-card"
              style={{
                marginTop: 16,
                padding: 16,
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,1))",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                Before you go…
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                <li>Your credits (if any) can be applied to this property.</li>
                <li>We’ll keep your review respectful and policy-safe.</li>
                <li>
                  If something felt off, your feedback helps us fix it fast.
                </li>
              </ul>
              <div className="muted-mini" style={{ marginTop: 8 }}>
                This is a guest-friendly flow with safe fallbacks for demo and
                live environments.
              </div>
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
              <span className="credits-badge">🙂 Smooth checkout</span>
              <span className="credits-badge">🌿 Hope you feel refreshed</span>
              <span className="credits-badge">🤝 See you again</span>
            </div>
          </div>

          {/* Right: Checkout form card */}
          <div className="premium-card" style={{ padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div className="checkout-kicker">Checkout</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>
                  Finalise your stay
                </div>
                <div className="muted" style={{ marginTop: 2 }}>
                  Booking code is auto-linked for safety.
                </div>
              </div>
              <div className="pill">Guest Flow</div>
            </div>

            {/* Credits block */}
            <div
              style={{
                marginTop: 18,
                padding: 16,
                borderRadius: 14,
                border: "1px solid rgba(0,0,0,0.06)",
                background:
                  "linear-gradient(135deg, rgba(20,90,242,0.05), rgba(16,185,129,0.04))",
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 6 }}>
                Use credits
              </div>
              <div className="muted">
                Credits are property-scoped and reduce your F&amp;B/services
                bill.
              </div>

              <label className="label" style={{ marginTop: 12 }}>
                Property slug
              </label>
              <input
                className="input"
                placeholder="e.g. sunrise"
                value={propertySlug}
                onChange={(e) => {
                  setPropertySlug(e.target.value);
                  if (!propertySlugFromQP) setPropertyLocked(false);
                }}
                readOnly={propertyLocked}
              />

              <label className="label" style={{ marginTop: 12 }}>
                Amount (₹)
              </label>
              <input
                className="input"
                type="number"
                min={0}
                step={1}
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                disabled={!propertySlug}
              />

              <div className="muted" style={{ marginTop: 6 }}>
                Available:{" "}
                <strong>
                  {loadingCredits ? "…" : `₹${availableForProperty}`}
                </strong>
              </div>

              <div style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  onClick={handleApplyCredits}
                  disabled={!propertySlug || amount <= 0}
                >
                  Apply credits
                </button>
              </div>

              {applyMsg ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  {applyMsg}
                </div>
              ) : null}
            </div>

            {/* Review consent */}
            <div style={{ marginTop: 18 }}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={consentReviews}
                  onChange={(e) => setConsentReviews(e.target.checked)}
                />
                <span>
                  I consent to publishing a truthful, activity-anchored review
                  for this stay.
                </span>
              </label>

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={autoPublish}
                  onChange={(e) => setAutoPublish(e.target.checked)}
                />
                <span>
                  Auto-publish the AI-generated review if policy allows (else
                  create a pending draft).
                </span>
              </label>
            </div>

            {/* Actions */}
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary btn-primary-premium"
                onClick={handleFinish}
              >
                Finish checkout
              </button>

              <Link
                className="btn"
                to={`/stay/${encodeURIComponent(bookingCode)}`}
              >
                Back to stay
              </Link>
            </div>

            {finishMsg ? (
              <div className="muted" style={{ marginTop: 10 }}>
                {finishMsg}
              </div>
            ) : null}

            <div className="muted-mini" style={{ marginTop: 16 }}>
              Note: Auto-publish respects your hotel’s policy (activity
              threshold, late SLA blocks, consent requirement).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
