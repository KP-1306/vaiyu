import { supabase } from '../lib/supabase';
import type {
    Ticket,
    TicketStatus,
    TicketEventType,
    ActorType,
    StartTaskParams,
    CompleteTaskParams,
    BlockTaskParams,
    UpdateStatusParams,
    UnblockTaskParams,
    PingSupervisorParams,

    StaffRunnerTicket,
    BlockReason,
    UnblockReason
} from '../types/ticket';


/**
 * Snapshot wrapper returned to UI.
 * UI uses fetchedAt to animate SLA locally.
 */
export type StaffTasksSnapshot = {
    fetchedAt: number; // epoch ms
    newTasks: StaffRunnerTicket[];
    inProgress: StaffRunnerTicket[];
    blocked: StaffRunnerTicket[];
};

/**
 * Utility used by UI to compute display SLA.
 * This DOES NOT affect DB or business logic.
 */
export function computeDisplayRemainingSeconds(
    serverRemaining: number | null,
    fetchedAt: number
): number | null {
    if (serverRemaining === null) return null;
    const elapsed = Math.floor((Date.now() - fetchedAt) / 1000);
    return Math.max(serverRemaining - elapsed, 0);
}

/**
 * Service for managing hotel tickets (production-grade, tenant-safe)
 */
export const ticketService = {

    /* ============================================================
     * Fetch single ticket (used for modal / details)
     * ============================================================ */
    async getTicket(ticketId: string): Promise<Ticket | null> {
        const { data, error } = await supabase
            .from('tickets')
            .select(`
                *,
                sla_state:ticket_sla_state(*),
                department:departments(*)
            `)
            .eq('id', ticketId)
            .single();

        if (error) {
            console.error('Error fetching ticket:', error);
            return null;
        }

        return data as Ticket;
    },

    /* ============================================================
     * Fetch staff tasks from optimized VIEW
     * Explicit hotel context is mandatory
     * ============================================================ */
    async getStaffTasks(hotelId: string): Promise<StaffTasksSnapshot> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        if (!hotelId) throw new Error('hotel_id is required');

        // Resolve membership for THIS hotel only
        const { data: member, error: mError } = await supabase
            .from('hotel_members')
            .select('*')
            .eq('user_id', user.id)
            .eq('hotel_id', hotelId)
            .eq('is_active', true)
            .maybeSingle();

        if (mError) {
            console.error('Error fetching hotel membership:', mError);
            throw new Error('Failed to resolve staff membership');
        }

        if (!member) {
            console.warn('User has no active membership for hotel', {
                user_id: user.id,
                hotel_id: hotelId
            });
            return {
                fetchedAt: Date.now(),
                newTasks: [],
                inProgress: [],
                blocked: []
            };
        }

        console.log('[DEBUG] Staff member found:', {
            id: member.id,
            hotel_id: member.hotel_id,
            role: member.role
        });

        const { data, error } = await supabase
            .from('v_staff_runner_tickets')
            .select('*')
            .eq('assigned_staff_id', member.id)
            .eq('hotel_id', hotelId)
            .order('sla_breached', { ascending: false })
            .order('sla_remaining_seconds', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching tasks from view:', error);
            return {
                fetchedAt: Date.now(),
                newTasks: [],
                inProgress: [],
                blocked: []
            };
        }

        const tickets = data as StaffRunnerTicket[];

        return {
            fetchedAt: Date.now(),
            newTasks: tickets.filter(t => t.status === 'NEW'),
            inProgress: tickets.filter(t => t.status === 'IN_PROGRESS'),
            blocked: tickets.filter(t => t.status === 'BLOCKED'),
        };
    },

    /* ============================================================
     * Event logging (audit-safe)
     * ============================================================ */
    async logEvent(params: {
        ticketId: string;
        eventType: TicketEventType;
        prevStatus?: string;
        newStatus?: string;
        reasonCode?: string;
        comment?: string;
        actorType?: ActorType;
        resumeAfter?: string;
        resume_after?: string;
    }) {
        const { data: { user } } = await supabase.auth.getUser();
        let actorId = user?.id;

        if (user && params.actorType !== 'SYSTEM') {
            const { data: member } = await supabase
                .from('hotel_members')
                .select('id')
                .eq('user_id', user.id)
                .maybeSingle();
            if (member) actorId = member.id;
        }

        await supabase
            .from('ticket_events')
            .insert({
                ticket_id: params.ticketId,
                event_type: params.eventType,
                previous_status: params.prevStatus,
                new_status: params.newStatus,
                reason_code: params.reasonCode,
                comment: params.comment,
                actor_type: params.actorType || 'STAFF',
                actor_id: actorId,
                resume_after: params.resume_after || params.resumeAfter
            });
    },

    /* ============================================================
     * Task lifecycle actions
     * ============================================================ */
    async startTask({ ticketId, note }: StartTaskParams) {
        // Use RPC to bypass RLS and ensure atomic state transition
        const { data: ticket, error } = await supabase
            .rpc('start_task', {
                p_ticket_id: ticketId,
                p_comment: note
            });

        if (error) {
            console.error('Start Task RPC Error:', error);
            throw new Error(`Failed to start task: ${error.message}`);
        }

        return ticket;
    },

    async completeTask({ ticketId, note }: CompleteTaskParams) {
        // Use RPC to bypass RLS and ensure atomic state transition
        const { data: ticket, error } = await supabase
            .rpc('complete_task', {
                p_ticket_id: ticketId,
                p_comment: note
            });

        if (error) {
            console.error('Complete Task RPC Error:', error);
            throw new Error(`Failed to complete task: ${error.message}`);
        }

        return ticket;
    },

    async blockTask({ ticketId, reasonCode, note, resumeAfter }: BlockTaskParams) {
        // Use RPC to bypass RLS and ensure atomic state transition
        const { data: ticket, error } = await supabase
            .rpc('block_task', {
                p_ticket_id: ticketId,
                p_reason_code: reasonCode,
                p_comment: note,
                p_resume_after: resumeAfter
            });

        if (error) {
            console.error('Block Task RPC Error:', error);
            throw new Error(`Failed to block task: ${error.message}`);
        }

        return ticket;
    },

    async unblockTask({ ticketId, unblockReasonCode, note }: UnblockTaskParams) {
        // Use RPC to bypass RLS and ensure atomic state transition
        const { data: ticket, error } = await supabase
            .rpc('unblock_task', {
                p_ticket_id: ticketId,
                p_unblock_reason_code: unblockReasonCode,
                p_comment: note
            });

        if (error) {
            console.error('Unblock Task RPC Error:', error);
            throw new Error(`Failed to unblock task: ${error.message}`);
        }

        return ticket;
    },

    async updateBlockTask({ ticketId, reasonCode, note, resumeAfter }: BlockTaskParams) {
        // Re-using BlockTaskParams as it has same shape (ticketId, reasonCode, note, resumeAfter)
        const { data: ticket, error } = await supabase
            .rpc('update_block_task', {
                p_ticket_id: ticketId,
                p_reason_code: reasonCode,
                p_comment: note,
                p_resume_after: resumeAfter
            });

        if (error) {
            console.error('Update Block Task RPC Error:', error);
            throw new Error(`Failed to update block: ${error.message}`);
        }

        return ticket;
    },

    /**
     * @deprecated Use unblockTask or updateBlockTask instead
     */
    async updateBlockedStatus({ ticketId, reasonCode, note, resume, resumeAfter }: UpdateStatusParams) {
        const now = new Date().toISOString();

        const newStatus: TicketStatus = resume ? 'IN_PROGRESS' : 'BLOCKED';
        const eventType: TicketEventType = resume ? 'UNBLOCKED' : 'BLOCKED';

        const { error } = await supabase
            .from('tickets')
            .update({
                status: newStatus,
                reason_code: resume ? null : reasonCode,
                updated_at: now
            })
            .eq('id', ticketId);

        if (error) throw error;

        await this.logEvent({
            ticketId,
            eventType,
            prevStatus: 'BLOCKED',
            newStatus,
            reasonCode,
            comment: note,
            resumeAfter
        });
    },

    async pingSupervisor({ ticketId, note }: PingSupervisorParams) {
        await this.logEvent({
            ticketId,
            eventType: 'PING_SUPERVISOR',
            comment: note
        });
        return { success: true };
    },

    /* ============================================================
     * Realtime subscription (event-driven refresh)
     * ============================================================ */
    subscribeToTasks(callback: () => void) {
        return supabase
            .channel('staff-runner-feed')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'tickets' },
                () => callback()
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'ticket_sla_state' },
                () => callback()
            )
            .subscribe();
    },

    /* ============================================================
     * Reference data
     * ============================================================ */
    async getBlockReasons(): Promise<BlockReason[]> {
        const { data, error } = await supabase
            .from('block_reasons')
            .select('*')
            .eq('is_active', true)
            .order('label');

        if (error) {
            console.error('Error fetching block reasons:', error);
            return [];
        }

        const reasons = data as BlockReason[];
        const others = reasons.filter(r => r.code !== 'something_else');
        const somethingElse = reasons.find(r => r.code === 'something_else');

        return somethingElse ? [...others, somethingElse] : others;
    },

    async getCompatibleUnblockReasons(blockReasonCode: string): Promise<UnblockReason[]> {
        // Fetch unblock reasons compatible with the specific block reason
        // Join with definition table to get labels/icons
        const { data, error } = await supabase
            .from('block_unblock_compatibility')
            .select(`
                unblock_reason:unblock_reasons!inner (
                    code,
                    label,
                    icon,
                    description
                )
            `)
            .eq('block_reason_code', blockReasonCode);

        if (error) {
            console.error('Error fetching compatible unblock reasons:', error);
            return [];
        }

        // Map nested response to flat array
        return data.map((item: any) => item.unblock_reason) as UnblockReason[];
    }

};
