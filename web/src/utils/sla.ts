// SLA utility functions for production-grade ticket management

import type { Ticket, SLAStatus } from '../types/ticket';

// Default target if no policy is found
const DEFAULT_SLA_MINUTES = 30;

/**
 * Calculate time remaining for a ticket considering SLA pauses
 */
export function calculateTimeRemaining(ticket: Ticket): number {
    const sla = ticket.sla_state;

    // If SLA hasn't started yet
    if (!sla?.sla_started_at) {
        // Here we might need the policy target, but for now we fallback
        return DEFAULT_SLA_MINUTES * 60;
    }

    const startTime = new Date(sla.sla_started_at).getTime();
    const now = Date.now();
    const elapsedMs = now - startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    // Subtract paused duration already recorded
    let activeSeconds = elapsedSeconds - (sla.total_paused_seconds || 0);

    // If currently paused, subtract the current pause duration too
    if (sla.sla_paused_at) {
        const pauseStart = new Date(sla.sla_paused_at).getTime();
        const currentPauseSeconds = Math.floor((now - pauseStart) / 1000);
        activeSeconds -= currentPauseSeconds;
    }

    const totalSlaSeconds = DEFAULT_SLA_MINUTES * 60; // Ideally from policy
    const remainingSeconds = totalSlaSeconds - activeSeconds;

    return Math.max(0, remainingSeconds);
}

/**
 * Get SLA status including breach information
 */
export function getSLAStatus(ticket: Ticket): SLAStatus {
    const timeRemaining = calculateTimeRemaining(ticket);
    const totalSlaSeconds = DEFAULT_SLA_MINUTES * 60;
    const timeElapsed = totalSlaSeconds - timeRemaining;

    return {
        timeRemaining,
        isBreached: timeRemaining === 0,
        percentComplete: Math.min(100, (timeElapsed / totalSlaSeconds) * 100),
    };
}

/**
 * Format seconds into human-readable time (e.g., "14 min", "2h 30m")
 */
export function formatTimeRemaining(seconds: number): string {
    if (seconds <= 0) return '0 min';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    return `${minutes} min`;
}

/**
 * Check if a ticket's SLA is breached
 */
export function isSLABreached(ticket: Ticket): boolean {
    return calculateTimeRemaining(ticket) === 0;
}

/**
 * Get color for SLA status (for UI)
 */
export function getSLAColor(ticket: Ticket): string {
    const { timeRemaining, isBreached } = getSLAStatus(ticket);
    const totalSeconds = DEFAULT_SLA_MINUTES * 60;
    const percentRemaining = (timeRemaining / totalSeconds) * 100;

    if (isBreached) return '#ef4444'; // red
    if (percentRemaining < 25) return '#f59e0b'; // amber
    if (percentRemaining < 50) return '#fbbf24'; // yellow
    return '#10b981'; // green
}
