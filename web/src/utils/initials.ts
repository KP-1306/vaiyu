// web/src/utils/initials.ts
// Derive display initials from a name LOCALLY. Replaces the previous
// ui-avatars.com avatar, which shipped the guest's full name to a third-party
// host on every render — an avoidable PII-egress point for a product handling
// Aadhaar/KYC. Initials are computed and rendered in our own DOM; nothing
// leaves the browser.

export function initialsOf(name?: string | null): string {
    const cleaned = (name ?? "").trim();
    if (!cleaned) return "?";
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
        // Single token → first two letters (e.g. "Myank" → "MY").
        return words[0].slice(0, 2).toUpperCase();
    }
    // Multiple tokens → first letter of the first two (e.g. "Asha Verma" → "AV").
    return (words[0][0] + words[1][0]).toUpperCase();
}
