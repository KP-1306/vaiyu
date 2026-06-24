// web/src/components/owner/FinanceErrorBoundary.tsx
// Scoped error boundary for the Pricing + Finance subtree. Keeps render-time
// crashes inside the dark Owner shell instead of bubbling to the app-wide
// GlobalErrorBoundary (which uses the marketing theme).

import React from "react";
import { AlertTriangle } from "lucide-react";
import { reportError } from "../../lib/observability";
import i18n from "../../i18n";
import { OWNER_I18N_ENABLED } from "../../i18n/useOwnerT";

const t = (key: string, en: string) =>
  OWNER_I18N_ENABLED ? i18n.t(key, { defaultValue: en, ns: "owner-cards" }) : en;

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export default class FinanceErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Structured report so a future Sentry/Datadog wire-up captures the
    // component stack + module tag without needing to touch this file again.
    reportError(error, {
      module: "finance",
      boundary: "FinanceErrorBoundary",
      componentStack: info.componentStack,
    });
  }

  handleReset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen w-full bg-[#0f1113] text-white font-['Outfit'] grid place-items-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-white">
                {t("financeError.title", "Something broke in Pricing / Finance")}
              </h2>
              <p className="mt-1 text-sm text-rose-200 break-words">
                {this.state.error.message || t("financeError.unknown", "Unknown render error.")}
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  onClick={this.handleReset}
                  className="rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition"
                >
                  {t("financeError.tryAgain", "Try again")}
                </button>
                <button
                  onClick={() => location.reload()}
                  className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition"
                >
                  {t("financeError.reload", "Reload page")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
