// web/src/components/OwnerDailyBriefCard.tsx
import React, { useMemo, useState } from "react";
import {
  buildOwnerDailyBrief,
  computeOwnerHealthTone,
  type OwnerBriefLanguage,
  type OwnerBriefInput,
  type OwnerBriefOutput,
} from "../lib/ownerDailyBrief";

export type OwnerDailyBriefCardProps = {
  language?: OwnerBriefLanguage;
  date?: string;
  hotelName: string;
  /** Optional city (for nicer copy + future use) */
  city?: string | null;

  // KPIs – all optional + nullable to keep callsites flexible
  occupancyPct?: number | null;
  openTasks?: number | null;
  /** Overdue tickets – used for tone, but safe if omitted */
  overdueTasks?: number | null;
  unhappyGuests?: number | null;
  slaOnTimePct?: number | null;
  todayRevenue?: number | null;
  openWorkforceRoles?: number | null;

  className?: string;
};

/**
 * OwnerDailyBriefCard
 *
 * UI wrapper around buildOwnerDailyBrief:
 * - Shows headline + short caption
 * - Visual health pill (red / yellow / green) for low-literacy owners
 * - Buttons: Listen (TTS hook), Read text (expand), Send to WhatsApp
 * - Renders summary + actions when expanded
 */
export default function OwnerDailyBriefCard(
  props: OwnerDailyBriefCardProps
) {
  const {
    language = "en",
    date,
    hotelName,
    city = null,
    occupancyPct = null,
    openTasks = null,
    overdueTasks = null,
    unhappyGuests = null,
    slaOnTimePct = null,
    todayRevenue = null,
    openWorkforceRoles = null,
    className = "",
  } = props;

  const [showDetails, setShowDetails] = useState(false);

  const { brief, tone }: { brief: OwnerBriefOutput; tone: "good" | "ok" | "bad" } =
    useMemo(() => {
      const input: OwnerBriefInput = {
        language,
        date,
        hotelName,
        city,
        occupancyPct,
        openTasks,
        overdueTasks,
        unhappyGuests,
        slaOnTimePct,
        todayRevenue,
        openWorkforceRoles,
      };

      return {
        brief: buildOwnerDailyBrief(input),
        tone: computeOwnerHealthTone(input),
      };
    }, [
      language,
      date,
      hotelName,
      city,
      occupancyPct,
      openTasks,
      overdueTasks,
      unhappyGuests,
      slaOnTimePct,
      todayRevenue,
      openWorkforceRoles,
    ]);

  const handleListenClick = () => {
    // Placeholder: your dev can plug in actual TTS here
    // e.g. call backend or browser speech API
    // eslint-disable-next-line no-console
    console.log("[OwnerDailyBriefCard] Play TTS:", brief.speechText);
  };

  const handleWhatsAppClick = () => {
    const text = brief.textSummary || brief.speechText;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const todayLabel = useMemo(() => {
    if (date) {
      const d = new Date(date);
      if (!Number.isNaN(d.getTime())) {
        try {
          return d.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
        } catch {
          return null;
        }
      }
    }
    return null;
  }, [date]);

  // Simple visual status for low-literacy owners
  const healthEmoji = tone === "good" ? "🟢" : tone === "ok" ? "🟡" : "🔴";
  const healthLabel =
    tone === "good"
      ? language === "en"
        ? "Healthy today"
        : "Hotel healthy hai"
      : tone === "ok"
      ? language === "en"
        ? "Needs attention"
        : "Thoda dhyaan"
      : language === "en"
      ? "Urgent attention"
      : "Urgent dhyaan";

  return (
    <section
      className={`owner-card owner-daily-brief-card ${className}`.trim()}
    >
      <header className="owner-card-header">
        <div>
          <div className="owner-card-title">Today&apos;s brief</div>
          <div className="owner-card-subtitle">{brief.headline}</div>

          {/* Visual health pill – easy red / yellow / green signal */}
          <div className="owner-card-health">
            <span
              className="owner-card-health-emoji"
              aria-hidden="true"
            >
              {healthEmoji}
            </span>
            <span className="owner-card-health-label">
              {healthLabel}
            </span>
          </div>
        </div>

        <div className="owner-card-meta">
          {todayLabel && (
            <span className="owner-card-meta-pill">{todayLabel}</span>
          )}
        </div>
      </header>

      <p className="owner-card-caption">{brief.caption}</p>

      <div className="owner-card-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={handleListenClick}
        >
          Listen (1 min)
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => setShowDetails((v) => !v)}
        >
          {showDetails ? "Hide text" : "Read text"}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={handleWhatsAppClick}
        >
          Send to WhatsApp
        </button>
      </div>

      {showDetails && (
        <div className="owner-card-body">
          <p className="owner-brief-summary">{brief.textSummary}</p>
          {brief.actions && brief.actions.length > 0 && (
            <ul className="owner-brief-actions">
              {brief.actions.map((action, idx) => (
                <li key={idx}>{action}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
