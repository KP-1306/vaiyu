import { useState } from "react";

// BilingualNameField — an OPTIONAL Hindi-name input that sits next to an
// existing English name field in owner forms (menu items, services, room
// types). Leaving it blank changes nothing: the guest portal renders the
// English/as-authored name exactly as today. When filled, the Hindi name is
// shown to guests who pick Hindi.
//
// "Suggest" pre-fills an editable offline suggestion (curated dictionary first,
// phonetic fallback — NO translation API) for dish / service / room-type names.
// The owner reviews and edits before saving. The suggestion module is
// lazy-loaded on first click so it never ships in the guest bundle.

type Kind = "dish" | "service" | "roomType";

// Default input styling matches the food modal; callers in differently-shaded
// modals pass `inputClassName` so the field blends in.
const DEFAULT_INPUT_CLASS =
  "w-full bg-[#0B0F1A] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors";

export default function BilingualNameField({
  englishValue,
  value,
  onChange,
  kind = "dish",
  label = "Hindi name (optional)",
  placeholder = "अतिथि को हिंदी में दिखेगा",
  inputClassName = DEFAULT_INPUT_CLASS,
}: {
  /** the current English name, used as the source for the Suggest button */
  englishValue: string;
  /** current Hindi value (controlled) */
  value: string;
  onChange: (next: string) => void;
  kind?: Kind;
  label?: string;
  placeholder?: string;
  /** override the input class so the field matches its host modal's shade */
  inputClassName?: string;
}) {
  const [suggesting, setSuggesting] = useState(false);

  async function handleSuggest() {
    const src = (englishValue || "").trim();
    if (!src) return;
    setSuggesting(true);
    try {
      let suggestion = "";
      if (kind === "roomType") {
        // room types use the curated room-type token dictionary
        const { localizeRoomType } = await import("../i18n/localizeRoomType");
        suggestion = localizeRoomType(src, "hi");
      } else {
        const { transliterateHi } = await import("../i18n/transliterateHi");
        suggestion = transliterateHi(src);
      }
      if (suggestion && suggestion !== src) onChange(suggestion);
    } finally {
      setSuggesting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-medium text-slate-400">{label}</label>
        <button
          type="button"
          onClick={handleSuggest}
          disabled={!englishValue.trim() || suggesting}
          className="text-[11px] font-medium text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Offline transliteration suggestion — please review before saving"
        >
          {suggesting ? "…" : "Suggest in हिंदी"}
        </button>
      </div>
      <input
        type="text"
        lang="hi"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName}
        placeholder={placeholder}
      />
      <p className="text-[11px] text-slate-500 mt-1">
        Shown to guests viewing in Hindi. Leave blank to show the English name.
      </p>
    </div>
  );
}
