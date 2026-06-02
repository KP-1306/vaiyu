// web/src/routes/owner/WhatsAppInbox.tsx
//
// /owner/:slug/whatsapp — staff chat inbox for WhatsApp conversations.
//
// Layout:
//   [left] threads list, sorted by last_message_at DESC, unread badge
//   [right] message thread for the selected conversation +
//           reply composer (free-text in 24h window; template picker out)
//
// Realtime: subscribes to `wa_chat_messages` and `wa_chat_threads`
// postgres_changes so new inbound + delivery status flow without polling.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCheck,
  Clock,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';

import { supabase } from '../../lib/supabase';
import {
  listChatMessages,
  listChatThreads,
  markChatThreadRead,
  sendChatMessage,
  WaChatServiceError,
  type WaChatMessage,
  type WaChatThread,
} from '../../services/waChatService';

interface Hotel { id: string; name: string; slug: string }

export default function WhatsAppInbox() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Resolve hotel
  const hotelQ = useQuery<Hotel | null>({
    queryKey: ['wa-inbox', 'hotel', slug],
    queryFn: async () => {
      if (!slug) return null;
      const { data, error } = await supabase
        .from('hotels')
        .select('id, name, slug')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      return data as Hotel | null;
    },
    enabled: !!slug,
    staleTime: 60_000,
  });
  const hotel = hotelQ.data ?? null;

  // Threads
  const threadsQ = useQuery({
    queryKey: hotel?.id ? ['wa-threads', hotel.id] : ['wa-threads', 'noop'],
    queryFn: () => (hotel?.id ? listChatThreads(hotel.id) : Promise.resolve([] as WaChatThread[])),
    enabled: !!hotel?.id,
    staleTime: 5_000,
  });

  // Messages for selected
  const messagesQ = useQuery({
    queryKey: selectedThreadId ? ['wa-messages', selectedThreadId] : ['wa-messages', 'noop'],
    queryFn: () => (selectedThreadId ? listChatMessages(selectedThreadId, 200) : Promise.resolve([] as WaChatMessage[])),
    enabled: !!selectedThreadId,
    staleTime: 5_000,
  });

  // Realtime subscriptions
  useEffect(() => {
    if (!hotel?.id) return;
    const ch = supabase
      .channel(`wa-inbox-${hotel.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_chat_threads', filter: `hotel_id=eq.${hotel.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['wa-threads', hotel.id] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_chat_messages', filter: `hotel_id=eq.${hotel.id}` },
        (payload) => {
          qc.invalidateQueries({ queryKey: ['wa-threads', hotel.id] });
          const newRow = payload.new as WaChatMessage | undefined;
          if (newRow?.thread_id && newRow.thread_id === selectedThreadId) {
            qc.invalidateQueries({ queryKey: ['wa-messages', newRow.thread_id] });
          }
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [hotel?.id, selectedThreadId, qc]);

  // Auto-scroll messages to bottom on new message
  useEffect(() => {
    if (messagesQ.data && messagesQ.data.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messagesQ.data?.length]);

  // Mark thread read on open
  useEffect(() => {
    if (!selectedThreadId) return;
    const t = setTimeout(() => {
      markChatThreadRead(selectedThreadId).catch(() => { /* best-effort */ });
      qc.invalidateQueries({ queryKey: ['wa-threads', hotel?.id] });
    }, 300);
    return () => clearTimeout(t);
  }, [selectedThreadId, hotel?.id, qc]);

  const sendMut = useMutation({
    mutationFn: (body: string) => {
      if (!selectedThreadId) throw new Error('No thread');
      return sendChatMessage({ threadId: selectedThreadId, body });
    },
    onSuccess: () => {
      setReplyText('');
      setSendError(null);
      if (selectedThreadId) {
        qc.invalidateQueries({ queryKey: ['wa-messages', selectedThreadId] });
      }
    },
    onError: (e: unknown) => {
      if (e instanceof WaChatServiceError && e.code === 'WINDOW_CLOSED_USE_TEMPLATE') {
        setSendError(
          '24h window closed. Free-text isn\'t allowed — use a template via Owner Settings or wait for the guest to reply first.',
        );
      } else if (e instanceof Error) {
        setSendError(e.message);
      } else {
        setSendError('Failed to send.');
      }
    },
  });

  const threads = useMemo(() => threadsQ.data ?? [], [threadsQ.data]);
  const messages = useMemo(() => messagesQ.data ?? [], [messagesQ.data]);
  const selectedThread = threads.find((t) => t.id === selectedThreadId) ?? null;

  if (hotelQ.isLoading) {
    return (
      <main className="grid min-h-[40vh] place-items-center bg-[#0B0E14] text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </main>
    );
  }
  if (!hotel) {
    return <main className="mx-auto max-w-3xl px-4 py-10 text-sm text-slate-400">Hotel not found.</main>;
  }

  return (
    <main className="min-h-screen bg-[#0B0E14] text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-4">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <Link to={`/owner/${hotel.slug}/dashboard`} className="inline-flex items-center gap-1 text-[12px] text-slate-300 hover:text-slate-100">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <h1 className="inline-flex items-center gap-2 text-[13px] font-semibold">
            <MessageSquare className="h-4 w-4 text-emerald-300" /> WhatsApp · {hotel.name}
          </h1>
          <span className="text-[11px] text-slate-400">{threads.length} thread{threads.length === 1 ? '' : 's'}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[320px_1fr] md:h-[calc(100vh-110px)]">
          {/* Threads list */}
          <aside
            className="rounded-2xl border border-slate-800 bg-[#0F1320] overflow-y-auto"
            data-testid="wa-threads-list"
          >
            {threadsQ.isLoading ? (
              <div className="grid place-items-center py-10"><Loader2 className="h-4 w-4 animate-spin text-slate-500" /></div>
            ) : threads.length === 0 ? (
              <p className="p-4 text-[12px] text-slate-500">
                No conversations yet. New guest messages land here as they arrive.
              </p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedThreadId(t.id)}
                      className={`w-full px-3 py-2.5 text-left hover:bg-slate-800/40 ${
                        selectedThreadId === t.id ? 'bg-slate-800/60' : ''
                      }`}
                      data-testid={`wa-thread-row-${t.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] font-medium text-slate-100">
                          {t.guest_name || t.guest_phone}
                        </span>
                        {t.unread_count > 0 && (
                          <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            {t.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-500">
                        <span className="truncate">{t.guest_phone}</span>
                        <time>{formatRelative(t.last_message_at)}</time>
                      </div>
                      <WindowChip thread={t} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* Thread view */}
          <section className="rounded-2xl border border-slate-800 bg-[#0F1320] flex flex-col">
            {!selectedThread ? (
              <div className="flex flex-1 items-center justify-center p-6 text-[12px] text-slate-500">
                Select a conversation to view messages.
              </div>
            ) : (
              <>
                {/* Thread header */}
                <header className="border-b border-slate-800 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[13px] font-semibold text-slate-100">
                        {selectedThread.guest_name || selectedThread.guest_phone}
                      </div>
                      <div className="text-[10px] text-slate-500">{selectedThread.guest_phone}</div>
                    </div>
                    <WindowBanner thread={selectedThread} />
                  </div>
                </header>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2" data-testid="wa-messages">
                  {messagesQ.isLoading ? (
                    <div className="grid place-items-center py-6"><Loader2 className="h-4 w-4 animate-spin text-slate-500" /></div>
                  ) : messages.length === 0 ? (
                    <p className="text-center text-[12px] text-slate-500">No messages yet.</p>
                  ) : (
                    messages.map((m) => <MessageBubble key={m.id} message={m} />)
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Composer */}
                <footer className="border-t border-slate-800 p-3">
                  {sendError && (
                    <p className="mb-2 inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300" role="alert">
                      <AlertTriangle className="h-3 w-3" /> {sendError}
                    </p>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={
                        selectedThread.within_24h_window
                          ? 'Type a free-text reply…'
                          : 'Window closed — free-text not allowed. Use a template via Owner Settings.'
                      }
                      rows={2}
                      maxLength={4096}
                      disabled={!selectedThread.within_24h_window || sendMut.isPending}
                      className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[12px] text-slate-100 placeholder:text-slate-500 disabled:opacity-50"
                      data-testid="wa-composer-input"
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && replyText.trim()) {
                          e.preventDefault();
                          sendMut.mutate(replyText.trim());
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => sendMut.mutate(replyText.trim())}
                      disabled={!selectedThread.within_24h_window || sendMut.isPending || !replyText.trim()}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
                      data-testid="wa-composer-send"
                    >
                      {sendMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Send
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    ⌘+Enter to send. Max 4096 chars.
                  </p>
                </footer>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function WindowChip({ thread }: { thread: WaChatThread }) {
  if (!thread.last_inbound_at) return null;
  if (thread.within_24h_window) {
    return (
      <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-emerald-300">
        <ShieldCheck className="h-3 w-3" /> {formatHm(thread.window_seconds_remaining)} window
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-slate-500">
      <ShieldAlert className="h-3 w-3" /> window closed
    </span>
  );
}

function WindowBanner({ thread }: { thread: WaChatThread }) {
  if (thread.within_24h_window) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
        <Clock className="h-3 w-3" /> Free-text available {formatHm(thread.window_seconds_remaining)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-400">
      <ShieldAlert className="h-3 w-3" /> Window closed — templates only
    </span>
  );
}

function MessageBubble({ message: m }: { message: WaChatMessage }) {
  const inbound = m.direction === 'INBOUND';
  const isSystem = m.message_type === 'SYSTEM';

  const statusIcon =
    m.status === 'READ'      ? <CheckCheck className="h-3 w-3 text-emerald-400" /> :
    m.status === 'DELIVERED' ? <CheckCheck className="h-3 w-3 text-slate-400" /> :
    m.status === 'FAILED'    ? <AlertTriangle className="h-3 w-3 text-rose-400" /> :
                               null;

  if (isSystem) {
    return (
      <div className="text-center">
        <span className="inline-block rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
          {m.body}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-1.5 ${
          inbound ? 'bg-slate-800 text-slate-100' : 'bg-emerald-600/80 text-white'
        }`}
        data-testid={`wa-msg-${m.direction.toLowerCase()}`}
      >
        <p className="whitespace-pre-wrap text-[12px]">{m.body}</p>
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-70">
          <time>{formatTime(m.created_at)}</time>
          {m.is_bot && <span className="rounded bg-black/20 px-1">bot</span>}
          {m.message_type === 'TEMPLATE' && <span className="rounded bg-black/20 px-1">tpl</span>}
          {statusIcon}
        </div>
        {m.failed_reason && (
          <p className="mt-0.5 text-[10px] text-rose-300">{m.failed_reason}</p>
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  catch { return iso; }
}
function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff/60)}m`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h`;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  } catch { return iso; }
}
function formatHm(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
