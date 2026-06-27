import { useTranslation } from "react-i18next";

export default function SkipToContent() {
  const { t } = useTranslation("common");
  return (
    <a
      href="#main"
      className="skip-link"
    >
      {t("chrome.skipToContent", "Skip to content")}
    </a>
  );
}
