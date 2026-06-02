// web/src/services/waChatService.ts
//
// Typed wrappers for the WhatsApp chat surface.

import { supabase } from '../lib/supabase';

export type WaChatProvider = 'META_DIRECT' | 'INTERAKT';
export type WaChatMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WaChatMessageType =
  | 'TEXT' | 'BUTTON_REPLY' | 'LIST_REPLY' | 'TEMPLATE'
  | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'LOCATION' | 'CONTACTS' | 'SYSTEM';
export type WaChatMessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WaChatThread {
  id: string;
  hotel_id: string;
  guest_phone: string;
  guest_name: string | null;
  last_booking_id: string | null;
  last_message_at: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  unread_count: number;
  assigned_to: string | null;
  state: Record<string, unknown>;
  state_expires_at: string | null;
  within_24h_window: boolean;
  window_seconds_remaining: number;
  created_at: string;
  updated_at: string;
}

export interface WaChatMessage {
  id: string;
  thread_id: string;
  hotel_id: string;
  direction: WaChatMessageDirection;
  message_type: WaChatMessageType;
  body: string | null;
  payload: Record<string, unknown>;
  template_code: string | null;
  template_name: string | null;
  provider: WaChatProvider;
  provider_message_id: string | null;
  status: WaChatMessageStatus;
  failed_reason: string | null;
  staff_user_id: string | null;
  is_bot: boolean;
  linked_ticket_id: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
}

export type WaChatServiceErrorCode =
  | 'THREAD_NOT_FOUND'
  | 'NOT_A_MEMBER'
  | 'NOT_A_MANAGER'
  | 'BODY_REQUIRED'
  | 'BODY_TOO_LONG'
  | 'WINDOW_CLOSED_USE_TEMPLATE'
  | 'TICKET_NOT_FOUND'
  | 'CROSS_HOTEL_FORBIDDEN'
  | 'UNKNOWN';

export class WaChatServiceError extends Error {
  code: WaChatServiceErrorCode;
  constructor(code: WaChatServiceErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'WaChatServiceError';
  }
}

const KNOWN_CODES = new Set<string>([
  'THREAD_NOT_FOUND', 'NOT_A_MEMBER', 'NOT_A_MANAGER',
  'BODY_REQUIRED', 'BODY_TOO_LONG', 'WINDOW_CLOSED_USE_TEMPLATE',
  'TICKET_NOT_FOUND', 'CROSS_HOTEL_FORBIDDEN',
]);
function toErr(err: { message?: string } | null | undefined, fallback: string): never {
  const raw = err?.message ?? '';
  const code = [...KNOWN_CODES].find((c) => raw.includes(c));
  throw new WaChatServiceError((code as WaChatServiceErrorCode) ?? 'UNKNOWN', raw || fallback);
}

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listChatThreads(hotelId: string): Promise<WaChatThread[]> {
  const { data, error } = await supabase
    .from('v_chat_threads')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('last_message_at', { ascending: false })
    .limit(200);
  if (error) toErr(error, 'Failed to list threads');
  return (data ?? []) as WaChatThread[];
}

export async function listChatMessages(threadId: string, limit = 200): Promise<WaChatMessage[]> {
  const { data, error } = await supabase
    .from('wa_chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) toErr(error, 'Failed to list messages');
  return (data ?? []) as WaChatMessage[];
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function sendChatMessage(args: {
  threadId: string;
  body: string;
  templateCode?: string;
  payload?: Record<string, unknown>;
}): Promise<{ message_id: string; notification_id: string; within_24h_window: boolean }> {
  const { data, error } = await supabase.rpc('send_chat_message', {
    p_thread_id: args.threadId,
    p_body: args.body,
    p_template_code: args.templateCode ?? null,
    p_payload: args.payload ?? {},
  });
  if (error) toErr(error, 'Failed to send');
  return data as { message_id: string; notification_id: string; within_24h_window: boolean };
}

export async function markChatThreadRead(threadId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_chat_thread_read', { p_thread_id: threadId });
  if (error) toErr(error, 'Failed to mark read');
}

export async function assignChatThread(threadId: string, userId: string | null): Promise<void> {
  const { error } = await supabase.rpc('assign_chat_thread', {
    p_thread_id: threadId,
    p_user_id: userId,
  });
  if (error) toErr(error, 'Failed to assign');
}

export async function linkTicketToChatThread(args: {
  ticketId: string;
  threadId: string;
  note?: string;
}): Promise<void> {
  const { error } = await supabase.rpc('link_ticket_to_chat_thread', {
    p_ticket_id: args.ticketId,
    p_thread_id: args.threadId,
    p_note: args.note ?? null,
  });
  if (error) toErr(error, 'Failed to link ticket');
}
