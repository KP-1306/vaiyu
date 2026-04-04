// web/src/routes/GuestFeedback.tsx
// Public feedback page — accessible without login via token
// Similar pattern to PreCheckin.tsx

import React, { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

/* ─── Types ──────────────────────────────────────────────────────────────── */

type FeedbackState =
  | "loading"
  | "form"
  | "submitting"
  | "success"
  | "error"
  | "already_submitted"
  | "expired";

type BookingContext = {
  booking_id: string;
  booking_code: string;
  guest_name: string;
  hotel_id: string;
  hotel_name: string;
  hotel_slug: string;
  checkin_date: string;
  checkout_date: string;
  guest_id: string | null;
};

type Category = {
  id: string;
  code: string;
  label: string;
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const EMOJI_MAP: Record<string, string> = {
  cleanliness: "✨",
  staff: "🧑‍💼",
  room: "🛌",
  service: "🛎️",
  location: "📍",
  food: "🍽️",
  amenities: "🏊",
  value: "💰",
};

const RATING_LABELS = ["", "Disappointing", "Poor", "Average", "Very Good", "Exceptional!"];

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/* ─── Styles (inline for self-contained public page) ─────────────────────── */

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #0f0f1a 0%, #1a1a2e 30%, #16213e 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px 16px 60px",
    fontFamily: "'Inter', 'Segoe UI', Arial, sans-serif",
  } as React.CSSProperties,

  card: {
    background: "rgba(255,255,255,0.04)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(212,165,116,0.15)",
    borderRadius: "20px",
    padding: "36px 28px",
    maxWidth: "520px",
    width: "100%",
    color: "#e8e8e8",
    boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
  } as React.CSSProperties,

  title: {
    fontSize: "26px",
    fontWeight: 700,
    color: "#d4a574",
    textAlign: "center" as const,
    margin: "0 0 6px",
    letterSpacing: "-0.3px",
  } as React.CSSProperties,

  subtitle: {
    fontSize: "14px",
    color: "rgba(255,255,255,0.55)",
    textAlign: "center" as const,
    margin: "0 0 28px",
    lineHeight: 1.5,
  } as React.CSSProperties,

  stayBadge: {
    display: "flex",
    justifyContent: "center",
    gap: "20px",
    marginBottom: "28px",
    padding: "14px 20px",
    background: "rgba(212,165,116,0.08)",
    borderRadius: "12px",
    border: "1px solid rgba(212,165,116,0.12)",
    fontSize: "13px",
    color: "rgba(255,255,255,0.65)",
    flexWrap: "wrap" as const,
  } as React.CSSProperties,

  overallRating: {
    textAlign: "center" as const,
    marginBottom: "28px",
  } as React.CSSProperties,

  starsRow: {
    display: "flex",
    justifyContent: "center",
    gap: "10px",
  } as React.CSSProperties,

  star: (filled: boolean) =>
    ({
      fontSize: "42px",
      cursor: "pointer",
      color: filled ? "#d4a574" : "rgba(255,255,255,0.12)",
      transition: "transform 0.15s ease, color 0.2s ease",
      userSelect: "none" as const,
    }) as React.CSSProperties,

  ratingLabel: {
    marginTop: "10px",
    fontSize: "14px",
    color: "#d4a574",
    fontWeight: 600,
    letterSpacing: "0.3px",
  } as React.CSSProperties,

  sectionTitle: {
    fontSize: "13px",
    color: "rgba(255,255,255,0.5)",
    textAlign: "center" as const,
    marginBottom: "16px",
    letterSpacing: "0.3px",
  } as React.CSSProperties,

  categoryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.03)",
    marginBottom: "8px",
    border: "1px solid rgba(255,255,255,0.04)",
  } as React.CSSProperties,

  categoryLabel: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "14px",
    color: "rgba(255,255,255,0.75)",
    fontWeight: 500,
  } as React.CSSProperties,

  miniStarsRow: {
    display: "flex",
    gap: "4px",
  } as React.CSSProperties,

  miniStar: (filled: boolean) =>
    ({
      fontSize: "20px",
      cursor: "pointer",
      color: filled ? "#d4a574" : "rgba(255,255,255,0.1)",
      transition: "color 0.15s ease",
      userSelect: "none" as const,
    }) as React.CSSProperties,

  textarea: {
    width: "100%",
    minHeight: "100px",
    padding: "14px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "#e8e8e8",
    fontSize: "14px",
    lineHeight: 1.6,
    resize: "vertical" as const,
    outline: "none",
    fontFamily: "inherit",
    marginTop: "16px",
    marginBottom: "20px",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,

  submitBtn: (disabled: boolean) =>
    ({
      display: "block",
      width: "100%",
      padding: "16px",
      borderRadius: "50px",
      border: "none",
      background: disabled
        ? "rgba(212,165,116,0.3)"
        : "linear-gradient(135deg, #d4a574, #c49660)",
      color: disabled ? "rgba(255,255,255,0.5)" : "#1a1a2e",
      fontSize: "16px",
      fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer",
      letterSpacing: "0.3px",
      boxShadow: disabled ? "none" : "0 4px 15px rgba(212,165,116,0.35)",
      transition: "all 0.2s ease",
    }) as React.CSSProperties,

  googleUpsell: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    padding: "16px",
    borderRadius: "12px",
    background: "rgba(66,133,244,0.08)",
    border: "1px solid rgba(66,133,244,0.15)",
    marginBottom: "20px",
  } as React.CSSProperties,

  googleIcon: {
    width: "40px",
    height: "40px",
    borderRadius: "10px",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
    fontWeight: 800,
    color: "#4285f4",
    flexShrink: 0,
  } as React.CSSProperties,

  successIcon: {
    fontSize: "72px",
    display: "block",
    textAlign: "center" as const,
    marginBottom: "20px",
    animation: "feedback-bounce 0.6s ease",
  } as React.CSSProperties,

  errorBox: {
    textAlign: "center" as const,
    padding: "32px",
  } as React.CSSProperties,

  errorIcon: {
    fontSize: "56px",
    display: "block",
    textAlign: "center" as const,
    marginBottom: "16px",
  } as React.CSSProperties,

  poweredBy: {
    textAlign: "center" as const,
    marginTop: "24px",
    fontSize: "11px",
    color: "rgba(255,255,255,0.25)",
    letterSpacing: "0.5px",
  } as React.CSSProperties,
};

/* ─── Animation CSS (injected once) ──────────────────────────────────────── */

const ANIMATION_CSS = `
@keyframes feedback-bounce {
  0% { transform: scale(0.3); opacity: 0; }
  50% { transform: scale(1.1); }
  70% { transform: scale(0.95); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes feedback-fadeIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
.feedback-animate-in {
  animation: feedback-fadeIn 0.5s ease forwards;
}
.feedback-star:hover {
  transform: scale(1.15) !important;
}
`;

/* ─── Main Component ─────────────────────────────────────────────────────── */

export default function GuestFeedback() {
  const { token } = useParams<{ token: string }>();

  const [state, setState] = useState<FeedbackState>("loading");
  const [context, setContext] = useState<BookingContext | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [overallRating, setOverallRating] = useState(0);
  const [categoryRatings, setCategoryRatings] = useState<Record<string, number>>({});
  const [reviewText, setReviewText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [hoveredStar, setHoveredStar] = useState(0);

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setState("error");
      setErrorMsg("No feedback token provided");
      return;
    }

    async function validate() {
      try {
        const { data, error } = await supabase.rpc("validate_feedback_token", {
          p_token: token,
        });

        if (error) throw error;

        if (!data?.valid) {
          if (data?.already_submitted) {
            setState("already_submitted");
          } else if (data?.error?.includes("expired")) {
            setState("expired");
          } else {
            setState("error");
            setErrorMsg(data?.error || "Invalid feedback link");
          }
          return;
        }

        setContext({
          booking_id: data.booking_id,
          booking_code: data.booking_code,
          guest_name: data.guest_name,
          hotel_id: data.hotel_id,
          hotel_name: data.hotel_name,
          hotel_slug: data.hotel_slug,
          checkin_date: data.checkin_date,
          checkout_date: data.checkout_date,
          guest_id: data.guest_id,
        });

        // Fetch review categories for this hotel
        const { data: cats, error: catErr } = await supabase
          .from("review_categories")
          .select("id, code, label")
          .eq("hotel_id", data.hotel_id)
          .eq("is_active", true)
          .order("display_order", { ascending: true });

        if (!catErr && cats) {
          setCategories(cats);
          const initial: Record<string, number> = {};
          cats.forEach((c: Category) => (initial[c.id] = 0));
          setCategoryRatings(initial);
        }

        setState("form");
      } catch (err: any) {
        console.error("Feedback validation error:", err);
        setState("error");
        setErrorMsg("Something went wrong. Please try again later.");
      }
    }

    validate();
  }, [token]);

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!token || !context || overallRating === 0) return;

    setState("submitting");

    try {
      const categoryRatingsArray = Object.entries(categoryRatings)
        .filter(([, rating]) => rating > 0)
        .map(([category_id, rating]) => ({ category_id, rating }));

      const { data, error } = await supabase.rpc("submit_public_feedback", {
        p_token: token,
        p_data: {
          overall_rating: overallRating,
          review_text: reviewText.trim() || null,
          category_ratings: categoryRatingsArray,
          is_anonymous: false,
        },
      });

      if (error) throw error;

      if (!data?.success) {
        if (data?.already_submitted) {
          setState("already_submitted");
        } else {
          setState("error");
          setErrorMsg(data?.error || "Failed to submit feedback");
        }
        return;
      }

      setState("success");
    } catch (err: any) {
      console.error("Feedback submission error:", err);
      setState("error");
      setErrorMsg("Failed to submit feedback. Please try again.");
    }
  }, [token, context, overallRating, reviewText, categoryRatings]);

  // Inject animation CSS
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.textContent = ANIMATION_CSS;
    document.head.appendChild(styleEl);
    return () => {
      document.head.removeChild(styleEl);
    };
  }, []);

  /* ─── Render states ──────────────────────────────────────────────────── */

  // Loading
  if (state === "loading") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                border: "3px solid rgba(212,165,116,0.2)",
                borderTop: "3px solid #d4a574",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                margin: "0 auto 16px",
              }}
            />
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "14px" }}>
              Loading your feedback form...
            </p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        </div>
      </div>
    );
  }

  // Already submitted
  if (state === "already_submitted") {
    return (
      <div style={styles.page}>
        <div style={styles.card} className="feedback-animate-in">
          <div style={styles.successIcon}>💚</div>
          <h1 style={styles.title}>Already Received!</h1>
          <p style={styles.subtitle}>
            Your feedback for this stay has already been submitted. Thank you for taking the time!
          </p>
          <p style={styles.poweredBy}>Powered by Vaiyu</p>
        </div>
      </div>
    );
  }

  // Expired
  if (state === "expired") {
    return (
      <div style={styles.page}>
        <div style={styles.card} className="feedback-animate-in">
          <div style={styles.errorIcon}>⏳</div>
          <h1 style={{ ...styles.title, color: "#e8e8e8" }}>Link Expired</h1>
          <p style={styles.subtitle}>
            This feedback link has expired. If you&apos;d still like to share your experience, please
            log in to your guest portal.
          </p>
          <a
            href="https://vaiyu.co.in/guest"
            style={{
              ...styles.submitBtn(false),
              textAlign: "center",
              textDecoration: "none",
              display: "block",
            }}
          >
            Go to Guest Portal
          </a>
          <p style={styles.poweredBy}>Powered by Vaiyu</p>
        </div>
      </div>
    );
  }

  // Error
  if (state === "error") {
    return (
      <div style={styles.page}>
        <div style={styles.card} className="feedback-animate-in">
          <div style={styles.errorBox}>
            <div style={styles.errorIcon}>😕</div>
            <h1 style={{ ...styles.title, color: "#e8e8e8" }}>
              {errorMsg || "Something went wrong"}
            </h1>
            <p style={styles.subtitle}>Please try again or contact the hotel directly.</p>
          </div>
          <p style={styles.poweredBy}>Powered by Vaiyu</p>
        </div>
      </div>
    );
  }

  // Success
  if (state === "success") {
    const firstName = context?.guest_name?.split(" ")[0] || "Guest";
    return (
      <div style={styles.page}>
        <div style={styles.card} className="feedback-animate-in">
          <div style={styles.successIcon}>🎉</div>
          <h1 style={styles.title}>Thank You, {firstName}!</h1>
          <p style={styles.subtitle}>
            Your feedback has been shared with {context?.hotel_name}. It means the world to us.
          </p>

          {overallRating >= 4 && (
            <div style={styles.googleUpsell}>
              <div style={styles.googleIcon}>G</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "#e8e8e8", marginBottom: "4px" }}>
                  Share on Google
                </div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
                  Help other travelers discover {context?.hotel_name}
                </div>
              </div>
              <a
                href={`https://search.google.com/local/writereview?placeid=`}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  background: "#4285f4",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                Write Review
              </a>
            </div>
          )}

          {overallRating <= 2 && (
            <div
              style={{
                padding: "16px",
                borderRadius: "12px",
                background: "rgba(255,200,100,0.06)",
                border: "1px solid rgba(255,200,100,0.12)",
                marginBottom: "20px",
              }}
            >
              <p
                style={{
                  fontSize: "13px",
                  color: "rgba(255,255,255,0.6)",
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                We&apos;re sorry your experience didn&apos;t meet expectations. Our management has been alerted
                and will look into your feedback personally.
              </p>
            </div>
          )}

          <a
            href="https://vaiyu.co.in"
            style={{
              ...styles.submitBtn(false),
              textAlign: "center",
              textDecoration: "none",
              display: "block",
            }}
          >
            Visit Vaiyu
          </a>
          <p style={styles.poweredBy}>Powered by Vaiyu</p>
        </div>
      </div>
    );
  }

  /* ─── Form state ──────────────────────────────────────────────────────── */

  const firstName = context?.guest_name?.split(" ")[0] || "Guest";
  const isSubmitting = state === "submitting";
  const canSubmit = overallRating > 0 && !isSubmitting;

  return (
    <div style={styles.page}>
      <div style={styles.card} className="feedback-animate-in">
        {/* Header */}
        <h1 style={styles.title}>How Was Your Stay?</h1>
        <p style={styles.subtitle}>
          Hi {firstName}, thank you for staying at{" "}
          <strong style={{ color: "#d4a574" }}>{context?.hotel_name}</strong>.<br />
          We&apos;d love to hear your thoughts.
        </p>

        {/* Stay Info */}
        {context?.checkin_date && context?.checkout_date && (
          <div style={styles.stayBadge}>
            <span>📅 {formatDate(context.checkin_date)} → {formatDate(context.checkout_date)}</span>
            {context.booking_code && (
              <span>🔖 {context.booking_code}</span>
            )}
          </div>
        )}

        {/* Overall Rating */}
        <div style={styles.overallRating}>
          <div style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((star) => (
              <span
                key={star}
                className="feedback-star"
                style={styles.star(star <= (hoveredStar || overallRating))}
                onClick={() => setOverallRating(star)}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                role="button"
                aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
              >
                ★
              </span>
            ))}
          </div>
          {overallRating > 0 && (
            <p style={styles.ratingLabel}>{RATING_LABELS[overallRating]}</p>
          )}
        </div>

        {/* Category Ratings + Review Text (shown after overall rating) */}
        {overallRating > 0 && (
          <div className="feedback-animate-in">
            {/* Category Ratings */}
            {categories.length > 0 && (
              <>
                <p style={styles.sectionTitle}>Rate each area (optional)</p>
                {categories.map((cat) => (
                  <div key={cat.id} style={styles.categoryRow}>
                    <div style={styles.categoryLabel}>
                      <span>{EMOJI_MAP[cat.code] || "⭐"}</span>
                      {cat.label}
                    </div>
                    <div style={styles.miniStarsRow}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span
                          key={s}
                          style={styles.miniStar(s <= (categoryRatings[cat.id] || 0))}
                          onClick={() =>
                            setCategoryRatings((prev) => ({ ...prev, [cat.id]: s }))
                          }
                          role="button"
                          aria-label={`Rate ${cat.label} ${s} star${s > 1 ? "s" : ""}`}
                        >
                          ★
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Review Text */}
            <textarea
              style={styles.textarea}
              placeholder={
                overallRating <= 3
                  ? "What could we have done better? Your honest feedback helps us improve..."
                  : "What made your stay special? Tell us more..."
              }
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              maxLength={2000}
            />

            {/* Google upsell for high ratings */}
            {overallRating >= 4 && (
              <div style={styles.googleUpsell}>
                <div style={styles.googleIcon}>G</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#e8e8e8", marginBottom: "2px" }}>
                    Also share on Google?
                  </div>
                  <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)" }}>
                    Support {context?.hotel_name} by leaving a public review.
                  </div>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              style={styles.submitBtn(!canSubmit)}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {isSubmitting ? "Submitting..." : "Submit Feedback"}
            </button>
          </div>
        )}

        <p style={styles.poweredBy}>Powered by Vaiyu</p>
      </div>
    </div>
  );
}
