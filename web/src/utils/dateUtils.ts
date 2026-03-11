/**
 * Parses a database timestamp string into a JavaScript Date object, 
 * treating it as UTC if no timezone information is present.
 * 
 * Safely handles:
 * - Missing timezones (`2026-03-09T06:17:22` -> UTC)
 * - Milliseconds (`2026-03-09T06:17:22.123` -> UTC)
 * - Explicit UTC (`2026-03-09T06:17:22Z` -> Keep)
 * - Explicit positive offsets (`2026-03-09T06:17:22+05:30` -> Keep)
 * - Explicit negative offsets (`2026-03-09T06:17:22-04:00` -> Keep)
 */
export const parseDbDate = (dateStr?: string | null): Date | null => {
    if (!dateStr) return null;

    const ts = dateStr.trim();

    // If timestamp has no timezone info, treat it as UTC
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(ts)) {
        return new Date(ts + "Z");
    }

    return new Date(ts);
};

/**
 * Formats a Date into a human-friendly relative time string.
 */
export const formatRelativeTime = (date: Date | null | string): string => {
    if (!date) return '---';

    const d = typeof date === 'string' ? parseDbDate(date) : date;
    if (!d) return '---';

    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - d.getTime());

    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMins / 60);

    if (diffSeconds < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    const dateStr = d.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    const timeStr = d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    if (dateStr === yesterdayStr) return `Yesterday at ${timeStr}`;

    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeStr}`;
};