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
 * Service for managing hotel tickets with production-grade normalization (V1 Schema + Views)
 */
export const ticketService = {
    /**
     * Fetch a single ticket by ID with its SLA state and Department
     * (Still used for modal details/actions if needed, though View covers most)
     */
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

    /**
     * Fetch tasks using the optimized SQL view `v_staff_runner_tickets`
     * This view already pre-calculates SLA status, labels, and authorization content.
     */
    async getStaffTasks(): Promise<{ newTasks: StaffRunnerTicket[]; inProgress: StaffRunnerTicket[]; blocked: StaffRunnerTicket[] }> {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        // 1. Resolve current_staff_id (the internal ID in hotel_members)
        const { data: members, error: mError } = await supabase
            .from('hotel_members')
            .select('*')
            .eq('user_id', user.id);

        if (mError) {
            console.error('Error fetching staff member profile:', mError);
        }

        const member = members?.find(m => m.is_active === true || (m as any).active === true) || members?.[0];

        if (!member) {
            console.warn('No membership found in hotel_members for user:', user.id);
            return { newTasks: [], inProgress: [], blocked: [] };
        }

        // 2. Fetch from VIEW filtering by assigned_staff_id
        const { data, error } = await supabase
            .from('v_staff_runner_tickets')
            .select('*')
            .eq('assigned_staff_id', member.id)
            .order('sla_breached', { ascending: false })
            .order('sla_remaining_seconds', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching tasks from view:', error);
            return { newTasks: [], inProgress: [], blocked: [] };
        }

        const myTickets = data as StaffRunnerTicket[];

        return {
            newTasks: myTickets.filter(t => t.status === 'NEW'),
            inProgress: myTickets.filter(t => t.status === 'IN_PROGRESS'),
            blocked: myTickets.filter(t => t.status === 'BLOCKED'),
        };
    },

    /**
     * Log a structured event
     */
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
        let actorId = user?.id; // Fallback

        // Try to resolve hotel_member id
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

    /**
     * Start a task (NEW -> IN_PROGRESS)
     */
    async startTask({ ticketId, note }: StartTaskParams) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data: member } = await supabase.from('hotel_members').select('id').eq('user_id', user.id).single();
        if (!member) throw new Error("Unauthorized");
        const now = new Date().toISOString();

        // 1. Update Ticket (Triggers SLA start if policy is ON_ASSIGN)
        const { data: ticket, error: ticketError } = await supabase
            .from('tickets')
            .update({
                status: 'IN_PROGRESS',
                current_assignee_id: member.id,
                updated_at: now
            })
            .eq('id', ticketId)
            .select()
            .single();

        if (ticketError) throw ticketError;

        // 2. Log Event
        await this.logEvent({
            ticketId,
            eventType: 'STARTED',
            prevStatus: 'NEW',
            newStatus: 'IN_PROGRESS',
            comment: note
        });

        return ticket;
    },

    /**
     * Complete a task
     */
    async completeTask({ ticketId, note }: CompleteTaskParams) {
        const now = new Date().toISOString();
        const { data: ticket, error } = await supabase
            .from('tickets')
            .update({ status: 'COMPLETED', completed_at: now, updated_at: now })
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

    /**
     * Block a task
     */
    async blockTask({ ticketId, reasonCode, note, resumeAfter }: BlockTaskParams) {
        const now = new Date().toISOString();

        // 1. Update Ticket (Triggers SLA pause via trg_pause_sla_on_block)
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

        // 2. Log Event
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

    /**
     * Resume or update blocked status
     */
    async updateBlockedStatus({ ticketId, reasonCode, note, resume, resumeAfter }: UpdateStatusParams) {
        const now = new Date().toISOString();

        let newStatus: TicketStatus = 'BLOCKED';
        let eventType: TicketEventType = 'BLOCKED';

        if (resume) {
            newStatus = 'IN_PROGRESS';
            eventType = 'UNBLOCKED';
        }

        // 1. Update Ticket (Triggers SLA resume if transitioning BLOCKED -> IN_PROGRESS)
        const { error } = await supabase
            .from('tickets')
            .update({
                status: newStatus,
                reason_code: resume ? null : reasonCode,
                updated_at: now
            })
            .eq('id', ticketId);

        if (error) throw error;

        // 2. Log Event
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

    /**
     * Ping supervisor
     */
    async pingSupervisor({ ticketId, note }: PingSupervisorParams) {
        await this.logEvent({ ticketId, eventType: 'PING_SUPERVISOR', comment: note });
        return { success: true };
    },

    /**
     * Real-time subscription
     */
    subscribeToTasks(callback: (payload: any) => void) {
        return supabase
            .channel('production-view-feed')
            .on(
                'postgres_changes',
                { event: '*', table: 'tickets', schema: 'public' },
                () => callback({})
            )
            .on(
                'postgres_changes',
                { event: '*', table: 'ticket_sla_state', schema: 'public' },
                () => callback({})
            )
            .subscribe();
    },

    /**
     * Get references
     */
    async getBlockReasons(): Promise<BlockReason[]> {
        const { data, error } = await supabase
            .from('block_reasons')
            .select('*')
            .eq('is_active', true)
            .order('label'); // or any specific ordering

        if (error) {
            console.error('Error fetching block reasons:', error);
            return [];
        }

        // Ensure "something_else" is always last
        const reasons = data as BlockReason[];
        const others = reasons.filter(r => r.code !== 'something_else');
        const somethingElse = reasons.find(r => r.code === 'something_else');

        return somethingElse ? [...others, somethingElse] : others;
    }
};
