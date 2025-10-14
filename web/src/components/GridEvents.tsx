import { useMemo } from "react";
import { downloadCsv } from "../lib/downloadCsv";
import { estimateKWh, estimateSavings, GridEventRow, minutesBetween } from "../lib/energy";
import { track } from "../lib/analytics";

export default function GridEventsTable({
  events,
  currency = "₹",
  tariffPerKWh = Number(import.meta.env.VITE_TARIFF_PER_KWH || 8), // sensible default
}: {
  events: GridEventRow[];
  currency?: string;
  tariffPerKWh?: number;
}) {
  const rows = useMemo(() => {
    return events.map(e => {
      const mins = minutesBetween(e.startedAt, e.endedAt);
      const kwh = estimateKWh(e);
      const money = estimateSavings(e, tariffPerKWh);
      return { ...e, mins, kwh: +kwh.toFixed(3), savings: money };
    });
  }, [events, tariffPerKWh]);

  function onExport() {
    const flat = rows.map(r => ({
      id: r.id,
      deviceId: r.deviceId,
      deviceName: r.deviceName || "",
      action: r.action,
      startedAt: r.startedAt,
      endedAt: r.endedAt || "",
      minutes: r.mins,
      watts: r.watts ?? "",
      kWh: r.kwh,
      savings: r.savings,
    }));
    downloadCsv(`grid-events-${new Date().toISOString().slice(0,10)}.csv`, flat);
    track("export_csv", { page: "grid_events" });
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">Events</div>
        <button onClick={onExport} className="btn btn-light">Export CSV</button>
      </div>

      <div className="overflow-auto -mx-2">
        <table className="min-w-[720px] w-full text-sm">
          <thead className="text-gray-500">
            <tr className="[&>th]:px-2 [&>th]:py-2 text-left">
              <th>Time</th>
              <th>Device</th>
              <th>Action</th>
              <th className="text-right">Minutes</th>
              <th className="text-right">Watts</th>
              <th className="text-right">kWh</th>
              <th className="text-right">Savings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="[&>td]:px-2 [&>td]:py-2 border-t border-black/5">
                <td className="whitespace-nowrap">
                  {new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {r.endedAt ? `–${new Date(r.endedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " (ongoing)"}
                </td>
                <td className="whitespace-nowrap">{r.deviceName || r.deviceId}</td>
                <td className="capitalize">{r.action}</td>
                <td className="text-right tabular-nums">{r.mins}</td>
                <td className="text-right tabular-nums">{r.watts ?? "—"}</td>
                <td className="text-right tabular-nums">{r.kwh}</td>
                <td className="text-right tabular-nums">{currency} {r.savings.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Savings are estimates: kWh = (watts × minutes / 60) / 1000; Savings = kWh × tariff ({currency}{tariffPerKWh}/kWh).
      </p>
    </div>
  );
}
