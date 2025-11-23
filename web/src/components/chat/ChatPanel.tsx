// web/src/components/chat/ChatPanel.tsx
import { useState } from "react";

export type ChatMessage = {
  id: string;
  /**
   * "guest" or "staff" or a more specific label
   * (we render guest messages on the right, staff on the left).
   */
  author: "guest" | "staff" | string;
  body: string;
  /** ISO string or Date – we only display local time. */
  at: string | Date;
};

export type ChatPanelProps = {
  /** Optional stay / booking code for context. */
  stayCode?: string;
  /** Optional hotel name, used in headings. */
  hotelName?: string | null;
  /** Prefetched messages, if you already have a thread. */
  messages?: ChatMessage[];
  /**
   * Called when guest sends a new message.
   * You can persist it to Supabase, etc.
   */
  onSend?: (body: string) => Promise<void> | void;
  /**
   * If provided, we show a secondary CTA to continue
   * the conversation on WhatsApp (deep link or wa.me).
   */
  openWhatsAppUrl?: string;
  /** Customise container classes when embedding inside a card. */
  className?: string;
};

/**
 * UI-only chat panel for the unified stay page.
 *
 * This component intentionally does NOT fetch or persist data by itself.
 * It just renders:
 *  - header with context,
 *  - scrollable message list (from props),
 *  - send box that calls onSend(body),
 *  - optional "Open WhatsApp" action.
 *
 * That keeps current behaviour safe and lets us plug in a real
 * chat backend later without breaking the QR journey.
 */
export default function ChatPanel({
  stayCode,
  hotelName,
  messages,
  onSend,
  openWhatsAppUrl,
  className,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const hasMessages = (messages?.length ?? 0) > 0;

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim()) return;
    const body = input.trim();
    setBusy(true);
    try {
      if (onSend) {
        await onSend(body);
      } else {
        // For now, just log – no-op; we don't mutate messages here
        console.log("[ChatPanel] onSend not wired. Message:", body);
      }
      setInput("");
    } catch (err) {
      console.error("[ChatPanel] send failed:", err);
      alert("We couldn't send your message. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="stay-chat"
      className={
        "rounded-2xl border bg-white/90 shadow-sm p-4 flex flex-col gap-3 " +
        (className || "")
      }
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Chat with front desk</h2>
          <p className="text-xs text-gray-600 mt-1">
            Ask for housekeeping, late checkout or anything else. For emergencies,
            please call the front desk directly.
          </p>
        </div>
        {openWhatsAppUrl && (
          <a
            href={openWhatsAppUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-light !py-1.5 !px-3 text-xs"
          >
            Open WhatsApp
          </a>
        )}
      </header>

      <div className="text-[11px] text-gray-500">
        {hotelName && <span className="font-medium">{hotelName}</span>}
        {hotelName && stayCode && <span> • </span>}
        {stayCode && <span>Stay code: {stayCode}</span>}
      </div>

      <div className="flex-1 min-h-[160px] max-h-64 border rounded-xl bg-slate-50/80 p-2 overflow-y-auto">
        {hasMessages ? (
          <ul className="space-y-1.5 text-xs">
            {messages!.map((m) => {
              const isGuest = m.author === "guest";
              const time =
                typeof m.at === "string"
                  ? new Date(m.at)
                  : m.at instanceof Date
                  ? m.at
                  : null;
              const timeLabel = time
                ? time.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";

              return (
                <li
                  key={m.id}
                  className={
                    "flex " + (isGuest ? "justify-end" : "justify-start")
                  }
                >
                  <div
                    className={
                      "max-w-[80%] rounded-2xl px-3 py-1.5 shadow-sm " +
                      (isGuest
                        ? "bg-sky-500 text-white rounded-br-sm"
                        : "bg-white text-gray-900 rounded-bl-sm")
                    }
                  >
                    <div className="text-[10px] opacity-75 mb-0.5">
                      {m.author === "guest"
                        ? "You"
                        : typeof m.author === "string"
                        ? m.author
                        : "Staff"}
                      {timeLabel && <span className="ml-1">• {timeLabel}</span>}
                    </div>
                    <div className="whitespace-pre-wrap break-words">
                      {m.body}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="h-full grid place-items-center text-[11px] text-gray-500 px-4 text-center">
            <div>
              No messages yet.
              <br />
              Send us a note below and the front desk will reply here.
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="flex items-end gap-2 pt-1">
        <textarea
          className="flex-1 rounded-xl border px-3 py-2 text-sm resize-none min-h-[44px] max-h-24"
          placeholder="Type your message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn"
          disabled={busy || !input.trim()}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
