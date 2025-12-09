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

        if (bookingCodeFromQP && typeof anyAPI.getPropertySlugForBooking === "function") {
          const slug = await anyAPI.getPropertySlugForBooking(bookingCodeFromQP);
          if (slug) {
            setPropertySlug(String(slug));
            setPropertyLocked(true);
            return;
          }
        }

        if (bookingCodeFromQP && typeof anyAPI.getStayByCode === "function") {
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
  }, [bookingCodeFromQP, bookingCodeFromQP, hotelIdFromQP, propertySlugFromQP]);

  /**
   * Load credits (if API supports it).
   * We do this even if propertySlug isn't ready yet.
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
    // hard clamp so user can never exceed balance in UI
    const safe = Math.min(n, availableForProperty || n);
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

    // If your old flow relied on a stay token, we try to surface it.
    // But we do NOT hard-block purely on this (more tolerant UX).
    const stayToken = readStayToken(bookingCode);

    try {
      const anyAPI = API as any;

      if (typeof anyAPI.redeemCredits === "function") {
        // Some implementations need token first arg, some don’t.
        // We try both safely.
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
        // Optimistically reduce local balance
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
      // Keep your original guidance but only when backend truly rejects
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

      // Save consent if your API supports it
      if (typeof anyAPI.setBookingConsent === "function") {
        try {
          await anyAPI.setBookingConsent(bookingCode, !!consentReviews);
        } catch {
          // non-fatal
        }
      }

      // Run checkout
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

      setFinishMsg("✅ Checkout completed.");

      // Navigate back depending on your flow
      if (from === "stay") {
        navigate(`/stay/${encodeURIComponent(bookingCode)}`);
      } else {
        navigate("/guest");
      }
    } catch (e: any) {
      setFinishMsg(`⚠️ Checkout failed. ${String(e?.message || "")}`);
    }
  }

  return (
    <div className="page checkout-page">
      <div className="page-inner">
        <h1>Checkout</h1>

        <div className="muted" style={{ marginBottom: 12 }}>
          Booking code: <strong>{bookingCode || "—"}</strong>
        </div>

        {/* Credits card */}
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="card-title">Use credits</div>
          <div className="muted">
            Credits are property-scoped and reduce your F&amp;B/services bill.
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
              I consent to publishing a truthful, activity-anchored review for
              this stay.
            </span>
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoPublish}
              onChange={(e) => setAutoPublish(e.target.checked)}
            />
            <span>
              Auto-publish the AI-generated review if policy allows (else create
              a pending draft).
            </span>
          </label>
        </div>

        {/* Actions */}
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={handleFinish}>
            Finish checkout
          </button>
          <Link className="btn" to={`/stay/${encodeURIComponent(bookingCode)}`}>
            Back to stay
          </Link>
        </div>

        {finishMsg ? (
          <div className="muted" style={{ marginTop: 10 }}>
            {finishMsg}
          </div>
        ) : null}

        <div className="muted" style={{ marginTop: 16, fontSize: 12 }}>
          Note: Auto-publish respects your hotel’s policy (activity threshold,
          late SLA blocks, consent requirement).
        </div>
      </div>
    </div>
  );
}
