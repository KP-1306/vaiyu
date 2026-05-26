// web/src/components/leads/LeadsExportButton.tsx
//
// Header button that exports the current filtered leads as CSV.
// Uses the active URL filters (Day 7), so the export matches what the
// operator is viewing.

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { exportLeadsCsv } from '../../services/leadCsvExport';
import { toServiceFilters, type LeadFiltersUrlState } from './leadsFilters';
import { LeadServiceError } from '../../services/leadService';
import { humanizeError } from './LeadQuickAddModal.errorMapping';

interface Props {
  hotelId: string;
  hotelSlug: string;
  filters: LeadFiltersUrlState;
  currentUserId: string | null;
  showToast: (msg: string, type: 'success' | 'error' | 'warning') => void;
}

export function LeadsExportButton({
  hotelId,
  hotelSlug,
  filters,
  currentUserId,
  showToast,
}: Props) {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      const serviceFilters = toServiceFilters(filters, currentUserId);
      await exportLeadsCsv({ hotelId, hotelSlug, filters: serviceFilters });
      showToast('CSV downloaded', 'success');
    } catch (err) {
      showToast(humanizeError(err as LeadServiceError), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="leads-export-button"
      onClick={handleClick}
      disabled={busy}
      title="Export filtered leads as CSV"
      aria-label="Export CSV"
      className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-xs font-medium text-white/70 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] ring-1 ring-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{busy ? 'Exporting…' : 'Export CSV'}</span>
    </button>
  );
}
