// web/src/components/chat/ChatPanel.tsx
import { useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabase";

export type ChatMessage = {
  id: string;
  author_role: "guest" | "staff";
  body: string;
  created_at: string;
};

export type ChatPanelProps = {
  /** The verified stay UUID (must match RLS or be verified by token) */
  stayId: string;
  /** Display label for context */
  hotelName?: string | null;
  /** Optional code for display */
  stayCode?: string;
  /** WhatsApp deep link as fallback */
  openWhatsAppUrl?: string;
  className?: string;
};

export default function ChatPanel({
  stayId,
  hotelName,
  stayCode,
  openWhatsAppUrl,
  className,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. Load initial history & Subscribe to Realtime
  useEffect(() => {
    if (!stayId) return;

    let channel: any = null;

    async function loadHistory() {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("stay_id", stayId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Failed to load chat history:", error);
      } else if (data) {
        setMessages(data as ChatMessage[]);
      }
    }

    function subscribe() {
      channel = supabase
        .channel(`stay-chat:${stayId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "chat_messages",
            filter: `stay_id=eq.${stayId}`,
          },
          (payload) => {
            const newMsg = payload.new as ChatMessage;
            setMessages((prev) => {
              // Dedupe just in case
              if (prev.some(m => m.id === newMsg.id)) return prev;
              return [...prev, newMsg];
            });
          }
        )
        .subscribe();
    }

    loadHistory().then(subscribe);

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [stayId]);

  // 2. Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const body = input.trim();
    if (!body) return;

    if (!stayId) {
      console.warn("[ChatPanel] Missing stayId. Cannot send.");
      // alert("Chat is connecting... please wait a moment."); 
      // Better UX: just return or show a toast. For debugging, let's log.
      return;
    }

    // Optimistic update
    const tempId = crypto.randomUUID();
    const optimisticMsg: ChatMessage = {
      id: tempId,
      author_role: "guest",
      body,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setInput("");
    setSending(true);

    try {
      // We rely on the backend finding the hotel_id from the stay_id or RLS defaults, 
      // but if we need to be explicit, we'd need to fetch the stay first.
      // However, for this UI-first pass, we'll try a direct insert. 
      // If it fails due to null hotel_id, we'll need to fetch it.

      const { error } = await supabase.from("chat_messages").insert({
        stay_id: stayId,
        // We fetch the hotel_id dynamically if needed, or rely on a trigger.
        // For now, let's fetch it to be safe.
        hotel_id: (await getHotelId(stayId)),
        author_role: "guest",
        body,
      });

      if (error) throw error;
    } catch (err) {
      console.error("Failed to send:", err);
      // Rollback optimistic? For now, simple alert or ignore as it might just be a duplicate.
    } finally {
      setSending(false);
    }
  }

  // Helper to get hotel_id if not passed (though we prefer props)
  async function getHotelId(sId: string) {
    const { data } = await supabase.from('stays').select('hotel_id').eq('id', sId).single();
    return data?.hotel_id;
  }

  return (
    <section
      id="stay-chat"
      className={
        "flex flex-col gap-3 rounded-[2rem] border border-slate-700/50 bg-[#1e293b] p-4 shadow-2xl " +
        (className || "")
      }
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-lg font-semibold text-white">Chat with front desk</h2>
          <div className="text-[11px] text-slate-400">
            {hotelName} {stayCode && <span>• {stayCode}</span>}
          </div>
        </div>
        {openWhatsAppUrl && (
          <a
            href={openWhatsAppUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 transition-colors"
          >
            WhatsApp
          </a>
        )}
      </header>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-[200px] max-h-[400px] space-y-3 overflow-y-auto p-2 scrollbar-hide"
      >
        {messages.length > 0 ? (
          messages.map((m) => {
            const isGuest = m.author_role === "guest";
            return (
              <div
                key={m.id}
                className={`flex w-full ${isGuest ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] px-4 py-2.5 shadow-sm text-sm whitespace-pre-wrap break-words ${isGuest
                    ? "bg-blue-600 text-white rounded-[1.25rem] rounded-tr-sm"
                    : "bg-slate-700 text-slate-100 rounded-[1.25rem] rounded-tl-sm"
                    }`}
                >
                  {m.body}
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-500 opacity-60">
            <svg
              className="mb-2 h-8 w-8 text-slate-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            <p className="text-xs">
              No messages yet.<br />
              Start the conversation below.
            </p>
          </div>
        )}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} className="relative flex items-center gap-2 pt-1">
        <input
          type="text"
          className="flex-1 rounded-full border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-white placeholder-slate-500 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Message front desk..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-500 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100"
        >
          {sending ? (
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg
              className="h-4 w-4 translate-x-0.5" // visual optic center
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </form>
    </section>
  );
}
