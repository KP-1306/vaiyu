import { Link } from "react-router-dom";

export default function WhatsNewBanner() {
  const items = [
    { tag: "New",    text: "Scan & check-in from your phone" },
    { tag: "Faster", text: "Room service with live ETA" },
    { tag: "Beta",   text: "Spend by year & bill downloads" },
  ];
  return (
    <div className="rounded-xl border bg-white/90 backdrop-blur px-3 py-2 shadow flex items-center gap-3">
      <span className="text-xs font-medium text-gray-700">What’s new</span>
      <ul className="flex items-center gap-3 text-xs text-gray-600 overflow-x-auto">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1 whitespace-nowrap">
            <span className="px-1.5 py-0.5 rounded-full border bg-gray-50 text-gray-700">{it.tag}</span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
      <div className="ml-auto">
        <Link to="/changelog" className="text-xs text-indigo-600 hover:underline">Details</Link>
      </div>
    </div>
  );
}
