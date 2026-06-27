import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function OnlineStatusBar() {
  const { t } = useTranslation("common");
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[1000] bg-amber-500 text-white text-center py-2">
      {t("chrome.offline", "You're offline. Changes may not sync.")}
    </div>
  );
}
