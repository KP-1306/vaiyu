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
    PingSupervisorParams,
    StaffRunnerTicket,
    BlockReason
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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data: member } = await supabase
            .from('hotel_members')
            .select('id')
            .eq('user_id', user.id)
            .single();

        if (!member) throw new Error('Unauthorized');

        const now = new Date().toISOString();

        const { data: ticket, error } = await supabase
            .from('tickets')
            .update({
                status: 'IN_PROGRESS',
                current_assignee_id: member.id,
                updated_at: now
            })
            .eq('id', ticketId)
            .select()
            .single();

        if (error) throw error;

        await this.logEvent({
            ticketId,
            eventType: 'STARTED',
            prevStatus: 'NEW',
            newStatus: 'IN_PROGRESS',
            comment: note
        });

        return ticket;
    },

    async completeTask({ ticketId, note }: CompleteTaskParams) {
        const now = new Date().toISOString();

        const { data: ticket, error } = await supabase
            .from('tickets')
            .update({
                status: 'COMPLETED',
                completed_at: now,
                updated_at: now
            })
            .eq('id', ticketId)
            .select()
            .single();

        if (error) throw error;

        await this.logEvent({
            ticketId,
            eventType: 'COMPLETED',
            prevStatus: 'IN_PROGRESS',
            newStatus: 'COMPLETED',
            comment: note
        });

        return ticket;
    },

    async blockTask({ ticketId, reasonCode, note, resumeAfter }: BlockTaskParams) {
        const now = new Date().toISOString();

        const { data: ticket, error } = await supabase
            .from('tickets')
            .update({
                status: 'BLOCKED',
                reason_code: reasonCode,
                updated_at: now
            })
            .eq('id', ticketId)
            .select()
            .single();

        if (error) throw error;

        await this.logEvent({
            ticketId,
            eventType: 'BLOCKED',
            prevStatus: 'IN_PROGRESS',
            newStatus: 'BLOCKED',
            reasonCode,
            comment: note,
            resumeAfter
        });

        return ticket;
    },

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
    }
};
