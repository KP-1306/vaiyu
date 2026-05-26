// web/src/services/leadCsvExport.ts
//
// Frontend wrapper for the leads-export-csv Edge Function. Authenticated
// via supabase.functions.invoke (which forwards the JWT). Triggers browser
// download via Blob + ephemeral <a> tag.
//
// Telemetry: addBreadcrumb on success/failure with duration. Server side
// also logs row_count + filter_summary.

import { supabase } from '../lib/supabase';
import { addBreadcrumb } from '../lib/monitoring';
import { LeadServiceError } from './leadService';
import type { LeadListFilters } from '../types/lead';

export interface ExportLeadsCsvOpts {
  hotelId: string;
  hotelSlug: string;
  filters: LeadListFilters;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportLeadsCsv(opts: ExportLeadsCsvOpts): Promise<void> {
  const start = performance.now();
  const filterSummary = {
    status: opts.filters.status ?? null,
    source: opts.filters.source ?? null,
    search: opts.filters.search ?? null,
    assignedTo: opts.filters.assignedTo ?? null,
  };

  const { data, error } = await supabase.functions.invoke('leads-export-csv', {
    body: {
      hotel_id: opts.hotelId,
      filters: {
        status: opts.filters.status,
        source: opts.filters.source,
        search: opts.filters.search,
        assignedTo: opts.filters.assignedTo,
        includeDeleted: opts.filters.includeDeleted ?? false,
      },
    },
    // Supabase invoke parses JSON by default; we need raw text/csv.
    headers: { Accept: 'text/csv' },
  });

  const duration_ms = Math.round(performance.now() - start);

  if (error) {
    addBreadcrumb({
      category: 'leadCsvExport',
      message: 'export failed',
      level: 'error',
      data: { hotelId: opts.hotelId, duration_ms, filterSummary, error: error.message },
    });
    throw new LeadServiceError(
      'UNKNOWN_ERROR',
      error.message || 'Could not export CSV',
      null,
      null,
      error,
    );
  }

  // `data` is either a Blob (when content-type is recognized as binary-ish)
  // or a string. Coerce to Blob.
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else if (typeof data === 'string') {
    blob = new Blob([data], { type: 'text/csv;charset=utf-8' });
  } else {
    // Fallback — Supabase wrapped it as JSON; serialize back.
    blob = new Blob([JSON.stringify(data)], { type: 'text/csv;charset=utf-8' });
  }

  const filename = `leads-${opts.hotelSlug}-${todayStamp()}.csv`;
  triggerDownload(blob, filename);

  addBreadcrumb({
    category: 'leadCsvExport',
    message: 'export ok',
    level: 'info',
    data: {
      hotelId: opts.hotelId,
      duration_ms,
      bytes: blob.size,
      filterSummary,
    },
  });
}
