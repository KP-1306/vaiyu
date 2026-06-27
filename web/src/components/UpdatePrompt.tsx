import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function UpdatePrompt() {
  const { t } = useTranslation("common");
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      if (reg.waiting) setWaiting(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && reg.waiting) {
            setWaiting(reg.waiting);
          }
        });
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // page will be controlled by the new SW — reload to apply
      window.location.reload();
    });
  }, []);

  if (!waiting) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-xl border px-4 py-3 bg-white shadow">
      <div className="text-sm">{t("chrome.updateAvailable", "A new version is available.")}</div>
      <div className="mt-2 flex gap-2">
        <button
          className="btn"
          onClick={() => waiting.postMessage({ type: 'SKIP_WAITING' })}
        >
          {t("chrome.updateNow", "Update now")}
        </button>
        <button className="btn btn-light" onClick={() => setWaiting(null)}>
          {t("chrome.updateLater", "Later")}
        </button>
      </div>
    </div>
  );
}
