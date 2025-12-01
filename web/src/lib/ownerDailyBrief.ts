// web/src/lib/ownerDailyBrief.ts

export type OwnerBriefLanguage = "en" | "hi" | "hinglish";

export type OwnerBriefInput = {
  language: OwnerBriefLanguage;
  /** ISO string or anything Date can parse; optional */
  date?: string;
  hotelName: string;
  /** Optional city label for nicer copy (e.g. “Hotel Demo, Goa”) */
  city?: string | null;

  // KPIs – kept optional + nullable so callers can send nothing/null
  occupancyPct?: number | null;
  openTasks?: number | null;
  unhappyGuests?: number | null;
  slaOnTimePct?: number | null;
  todayRevenue?: number | null;
  openWorkforceRoles?: number | null;

  /** Overdue requests (used only for tone; safe if omitted) */
  overdueTasks?: number | null;
};

export type OwnerBriefOutput = {
  headline: string;
  caption: string;
  speechText: string;
  textSummary: string;
  actions: string[];
};

export type OwnerHealthTone = "good" | "ok" | "bad";

type ActionKey =
  | "call_unhappy_guests"
  | "clear_pending_tasks"
  | "fix_sla"
  | "fix_pricing_low_occ"
  | "ensure_staffing_high_occ";

function safeInt(n: number | null | undefined): number | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return n;
}

function clampPct(value: number | null): number | null {
  if (value === null) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function getWeekdayLabel(dateStr?: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString("en-IN", { weekday: "long" });
  } catch {
    return null;
  }
}

function formatInr(value: number | null): string | null {
  if (value === null) return null;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `₹${Math.round(value)}`;
  }
}

/**
 * Internal score used for “healthy / okay / urgent” headline copy.
 * Kept as-is so existing headlines don’t change dramatically.
 */
function computeStatusScore(args: {
  occupancyPct: number | null;
  slaOnTimePct: number | null;
  unhappyGuests: number;
  openTasks: number;
}): number {
  const { occupancyPct, slaOnTimePct, unhappyGuests, openTasks } = args;
  let score = 0;

  if (occupancyPct !== null) {
    if (occupancyPct >= 70) score += 1;
    else if (occupancyPct < 35) score -= 1;
  }

  if (slaOnTimePct !== null) {
    if (slaOnTimePct >= 85) score += 1;
    else if (slaOnTimePct < 70) score -= 1;
  }

  if (unhappyGuests > 0) score -= 1;
  if (openTasks > 5) score -= 1;

  return score;
}

/**
 * Public helper for UI to decide emoji/colour.
 * Uses the same score as the headlines + a small penalty for overdue tasks.
 */
export function computeOwnerHealthTone(
  input: OwnerBriefInput
): OwnerHealthTone {
  const occupancyPct = clampPct(safeInt(input.occupancyPct));
  const slaOnTimePct = clampPct(safeInt(input.slaOnTimePct));
  const unhappyGuests = safeInt(input.unhappyGuests) ?? 0;
  const openTasks = safeInt(input.openTasks) ?? 0;
  const overdueTasks = safeInt(input.overdueTasks) ?? 0;

  let score = computeStatusScore({
    occupancyPct,
    slaOnTimePct,
    unhappyGuests,
    openTasks,
  });

  if (overdueTasks > 0) {
    score -= overdueTasks >= 5 ? 2 : 1;
  }

  if (score >= 1) return "good";
  if (score <= -2) return "bad";
  return "ok";
}

function getHeadlineAndCaption(
  language: OwnerBriefLanguage,
  score: number,
  weekday: string | null
): { headline: string; caption: string } {
  const dayPart = weekday ? ` ${weekday}` : "";

  if (language === "hinglish" || language === "hi") {
    if (score >= 1) {
      return {
        headline: "Hotel healthy hai",
        caption: `Aaj${dayPart} overall hotel theek aur stable chal raha hai.`,
      };
    }
    if (score <= -2) {
      return {
        headline: "Urgent dhyaan chahiye",
        caption: `Aaj${dayPart} kuch important issues hain, jinke upar jaldi action lena zaroori hai.`,
      };
    }
    return {
      headline: "Thoda dhyaan zaroori",
      caption: `Aaj${dayPart} hotel overall theek hai, lekin kuch points par dhyaan dena padega.`,
    };
  }

  // English
  if (score >= 1) {
    return {
      headline: "Hotel is healthy",
      caption: `Overall the hotel looks stable and under control${
        dayPart ? ` this ${weekday}` : ""
      }.`,
    };
  }
  if (score <= -2) {
    return {
      headline: "Needs urgent attention",
      caption: `There are a few important issues that need quick attention${
        dayPart ? ` this ${weekday}` : ""
      }.`,
    };
  }
  return {
    headline: "Needs attention",
    caption: `The hotel is okay overall but a few areas need your attention${
      dayPart ? ` this ${weekday}` : ""
    }.`,
  };
}

function computeActionKeys(args: {
  occupancyPct: number | null;
  slaOnTimePct: number | null;
  unhappyGuests: number;
  openTasks: number;
  openWorkforceRoles: number;
}): ActionKey[] {
  const {
    occupancyPct,
    slaOnTimePct,
    unhappyGuests,
    openTasks,
    openWorkforceRoles,
  } = args;

  const keys: ActionKey[] = [];

  if (unhappyGuests > 0) {
    keys.push("call_unhappy_guests");
  }

  if (openTasks > 0) {
    keys.push("clear_pending_tasks");
  }

  if (slaOnTimePct !== null && slaOnTimePct < 80) {
    keys.push("fix_sla");
  }

  if (occupancyPct !== null && occupancyPct < 40) {
    keys.push("fix_pricing_low_occ");
  }

  if (
    occupancyPct !== null &&
    occupancyPct >= 80 &&
    openWorkforceRoles > 0
  ) {
    keys.push("ensure_staffing_high_occ");
  }

  // De-duplicate
  return Array.from(new Set(keys));
}

function renderActions(
  language: OwnerBriefLanguage,
  keys: ActionKey[]
): string[] {
  if (language === "hinglish" || language === "hi") {
    const map: Record<ActionKey, string> = {
      call_unhappy_guests:
        "Jo guest unhappy dikha rahe hain unko front office se turant call karwaaiye.",
      clear_pending_tasks:
        "Top 3–5 pending tickets ko aaj hi close karne ke liye desk / housekeeping se follow-up kijiye.",
      fix_sla:
        "Jo tickets SLA se bahar jaa rahe hain unka quick review karke process tighten kijiye.",
      fix_pricing_low_occ:
        "Occupancy kam hai, isliye aaj ki room pricing aur offers ko Revenue view mein ek baar check kijiye.",
      ensure_staffing_high_occ:
        "Agle 1–2 din ke liye staffing aur shift planning dekh lijiye taaki high occupancy handle ho sake.",
    };
    return keys.map((k) => map[k]);
  }

  const map: Record<ActionKey, string> = {
    call_unhappy_guests:
      "Ask front office to call the unhappy guest(s) and close the loop.",
    clear_pending_tasks:
      "Clear the top 3–5 pending tickets with the desk / housekeeping team.",
    fix_sla:
      "Review tickets that are breaching SLA and tighten the follow-up process.",
    fix_pricing_low_occ:
      "Review today’s room pricing and offers in the Revenue view, since occupancy is low.",
    ensure_staffing_high_occ:
      "Double-check staffing and shift planning for the next 1–2 days to handle high occupancy.",
  };
  return keys.map((k) => map[k]);
}

function buildEnglishBrief(input: OwnerBriefInput): OwnerBriefOutput {
  const hotelName = input.hotelName || "your hotel";
  const city = input.city ?? null;
  const hotelLabel = city ? `${hotelName}, ${city}` : hotelName;
  const weekday = getWeekdayLabel(input.date);

  const occupancyPct = clampPct(safeInt(input.occupancyPct));
  const openTasks = safeInt(input.openTasks) ?? 0;
  const unhappyGuests = safeInt(input.unhappyGuests) ?? 0;
  const slaOnTimePct = clampPct(safeInt(input.slaOnTimePct));
  const todayRevenue = safeInt(input.todayRevenue);
  const openWorkforceRoles = safeInt(input.openWorkforceRoles) ?? 0;

  const score = computeStatusScore({
    occupancyPct,
    slaOnTimePct,
    unhappyGuests,
    openTasks,
  });
  const { headline, caption } = getHeadlineAndCaption(
    "en",
    score,
    weekday
  );

  const occLine =
    occupancyPct !== null
      ? `Occupancy is around ${occupancyPct}%.`
      : `Occupancy data is not available yet.`;
  const taskLine =
    openTasks > 0
      ? `You have ${openTasks} open ${
          openTasks === 1 ? "task" : "tasks"
        } on the system.`
      : `There are no pending tasks right now.`;
  const unhappyLine =
    unhappyGuests > 0
      ? `There ${unhappyGuests === 1 ? "is" : "are"} ${unhappyGuests} unhappy ${
          unhappyGuests === 1 ? "guest" : "guests"
        } waiting for a callback or resolution.`
      : `No unhappy guests are flagged at the moment.`;
  const slaLine =
    slaOnTimePct !== null
      ? `On-time SLA is approximately ${slaOnTimePct}%.`
      : ``;
  const revenueLabel = formatInr(todayRevenue);
  const revenueLine = revenueLabel
    ? `Estimated revenue so far today is about ${revenueLabel}.`
    : ``;

  const introDay = weekday ? `this ${weekday}` : "today";

  const speechTextLines = [
    `Good morning. ${hotelLabel} is ${
      score >= 1
        ? "looking healthy"
        : score <= -2
        ? "under some pressure"
        : "doing okay"
    } ${introDay}.`,
    taskLine,
    occLine,
    unhappyLine,
    slaLine,
    revenueLine,
  ].filter(Boolean);

  const actionKeys = computeActionKeys({
    occupancyPct,
    slaOnTimePct,
    unhappyGuests,
    openTasks,
    openWorkforceRoles,
  });
  const actions = renderActions("en", actionKeys).slice(0, 3);

  const textSummaryParts: string[] = [];
  if (occupancyPct !== null) {
    textSummaryParts.push(`Occ: ${occupancyPct}%`);
  }
  textSummaryParts.push(`Open tasks: ${openTasks}`);
  if (unhappyGuests > 0) {
    textSummaryParts.push(`Unhappy guests: ${unhappyGuests}`);
  }
  if (slaOnTimePct !== null) {
    textSummaryParts.push(`On-time SLA: ${slaOnTimePct}%`);
  }
  if (revenueLabel) {
    textSummaryParts.push(`Revenue so far: ${revenueLabel}`);
  }

  const textSummary =
    `Today at ${hotelLabel}: ` +
    textSummaryParts.join(" · ") +
    (actions.length
      ? `. Key actions: ${actions.join(" ")}`
      : `. No urgent actions needed right now.`);

  return {
    headline,
    caption,
    speechText: speechTextLines.join(" "),
    textSummary,
    actions,
  };
}

function buildHinglishBrief(input: OwnerBriefInput): OwnerBriefOutput {
  const hotelName = input.hotelName || "aapka hotel";
  const city = input.city ?? null;
  const hotelLabel = city ? `${hotelName}, ${city}` : hotelName;
  const weekday = getWeekdayLabel(input.date);

  const occupancyPct = clampPct(safeInt(input.occupancyPct));
  const openTasks = safeInt(input.openTasks) ?? 0;
  const unhappyGuests = safeInt(input.unhappyGuests) ?? 0;
  const slaOnTimePct = clampPct(safeInt(input.slaOnTimePct));
  const todayRevenue = safeInt(input.todayRevenue);
  const openWorkforceRoles = safeInt(input.openWorkforceRoles) ?? 0;

  const score = computeStatusScore({
    occupancyPct,
    slaOnTimePct,
    unhappyGuests,
    openTasks,
  });
  const { headline, caption } = getHeadlineAndCaption(
    "hinglish",
    score,
    weekday
  );

  const occLine =
    occupancyPct !== null
      ? `Occupancy abhi kareeb ${occupancyPct}% hai.`
      : `Occupancy ka data abhi available nahi hai.`;
  const taskLine =
    openTasks > 0
      ? `System mein abhi ${openTasks} kaam pending hain.`
      : `Abhi system mein koi pending task nahi hai.`;
  const unhappyLine =
    unhappyGuests > 0
      ? `Abhi ${unhappyGuests} guest unhappy flag hue hain, jo callback ya resolution ka wait kar rahe hain.`
      : `Abhi koi guest unhappy flag nahi hua hai.`;
  const slaLine =
    slaOnTimePct !== null
      ? `On-time SLA kareeb ${slaOnTimePct}% chal raha hai.`
      : ``;
  const revenueLabel = formatInr(todayRevenue);
  const revenueLine = revenueLabel
    ? `Aaj ka estimated revenue ab tak lagbhag ${revenueLabel} hai.`
    : ``;

  const introDay = weekday ? `is ${weekday}` : "aaj";

  const speechTextLines = [
    `Good morning. ${hotelLabel} ${introDay} overall ${
      score >= 1
        ? "kaafi healthy"
        : score <= -2
        ? "thoda pressure mein"
        : "theek-thaak"
    } chal raha hai.`,
    taskLine,
    occLine,
    unhappyLine,
    slaLine,
    revenueLine,
  ].filter(Boolean);

  const actionKeys = computeActionKeys({
    occupancyPct,
    slaOnTimePct,
    unhappyGuests,
    openTasks,
    openWorkforceRoles,
  });
  const actions = renderActions("hinglish", actionKeys).slice(0, 3);

  const textSummaryParts: string[] = [];
  if (occupancyPct !== null) {
    textSummaryParts.push(`Occ: ${occupancyPct}%`);
  }
  textSummaryParts.push(`Open tasks: ${openTasks}`);
  if (unhappyGuests > 0) {
    textSummaryParts.push(`Unhappy guests: ${unhappyGuests}`);
  }
  if (slaOnTimePct !== null) {
    textSummaryParts.push(`SLA on-time: ${slaOnTimePct}%`);
  }
  if (revenueLabel) {
    textSummaryParts.push(`Rev so far: ${revenueLabel}`);
  }

  const textSummary =
    `${hotelLabel} mein aaj ka snapshot: ` +
    textSummaryParts.join(" · ") +
    (actions.length
      ? `. Important actions: ${actions.join(" ")}`
      : `. Abhi koi urgent action zaroori nahi lag raha.`);

  return {
    headline,
    caption,
    speechText: speechTextLines.join(" "),
    textSummary,
    actions,
  };
}

function buildHindiBrief(input: OwnerBriefInput): OwnerBriefOutput {
  // For now, we’ll reuse the Hinglish structure but with slightly more Hindi flavour.
  // You can refine this later if you want pure Hindi.
  return buildHinglishBrief({ ...input, language: "hinglish" });
}

export function buildOwnerDailyBrief(
  input: OwnerBriefInput
): OwnerBriefOutput {
  const lang: OwnerBriefLanguage = input.language || "en";

  if (lang === "hinglish") {
    return buildHinglishBrief({ ...input, language: "hinglish" });
  }
  if (lang === "hi") {
    return buildHindiBrief({ ...input, language: "hi" });
  }
  return buildEnglishBrief({ ...input, language: "en" });
}
