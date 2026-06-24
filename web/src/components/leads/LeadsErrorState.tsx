// web/src/components/leads/LeadsErrorState.tsx

import { AlertTriangle, RotateCw } from 'lucide-react';
import { useOwnerT } from '../../i18n/useOwnerT';

interface Props {
  message: string;
  onRetry: () => void;
}

export function LeadsErrorState({ message, onRetry }: Props) {
  const t = useOwnerT('owner-leads');
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-red-500/10 p-4 mb-4 ring-1 ring-red-500/20">
        <AlertTriangle className="h-8 w-8 text-red-300" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-1">{t('errorState.title', 'Could not load leads')}</h3>
      <p className="text-sm text-white/60 max-w-md mb-6">{message}</p>
      <button
        type="button"
        data-testid="leads-error-retry"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors"
      >
        <RotateCw className="h-4 w-4" />
        {t('tryAgain', 'Try again')}
      </button>
    </div>
  );
}
