// web/src/components/OwnerDailyBriefCard.tsx
import React, { useMemo, useState } from "react";
import {
  buildOwnerDailyBrief,
  type OwnerBriefLanguage,
  type OwnerBriefInput,
  type OwnerBriefOutput,
} from "../lib/ownerDailyBrief";

export type OwnerDailyBriefCardProps = {
  language?: OwnerBriefLanguage;
  date?: string;
  hotelName: string;
  occupancyPct: number | null;
  openTasks: number | null;
  unhappyGuests: number | null;
  slaOnTimePct: number | null;
  todayRevenue: number | null;
  openWorkforceRoles: number | null;
  className?: string;
};

/**
 * OwnerDailyBriefCard
 *
 * UI wrapper around buildOwnerDailyBrief:
 * - Shows headline + short caption
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
    occupancyPct,
    openTasks,
    unhappyGuests,
    slaOnTimePct,
    todayRevenue,
    openWorkforceRoles,
    className = "",
  } = props;

  const [showDetails, setShowDetails] = useState(false);

  const brief: OwnerBriefOutput = useMemo(
    () =>
      buildOwnerDailyBrief({
        language,
        date,
        hotelName,
        occupancyPct,
        openTasks,
        unhappyGuests,
        slaOnTimePct,
        todayRevenue,
        openWorkforceRoles,
      } satisfies OwnerBriefInput),
    [
      language,
      date,
      hotelName,
      occupancyPct,
      openTasks,
      unhappyGuests,
      slaOnTimePct,
      todayRevenue,
      openWorkforceRoles,
    ]
  );

  const handleListenClick = () => {
    // Placeholder: your dev can plug in actual TTS here
    // e.g. call backend or browser speech API
    // For now, we just log:
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

  return (
    <section
      className={`owner-card owner-daily-brief-card ${className}`.trim()}
    >
      <header className="owner-card-header">
        <div>
          <div className="owner-card-title">Today&apos;s brief</div>
          <div className="owner-card-subtitle">{brief.headline}</div>
        </div>
        {todayLabel && (
          <div className="owner-card-meta">
            <span className="owner-card-meta-pill">{todayLabel}</span>
          </div>
        )}
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
