import React from "react";

export type GridEvent = {
  id?: string | number;
  at: string;                 // ISO or human time
  device?: string;
  action: string;             // e.g. "Shed", "Restore"
  details?: string;           // optional extra info
};

type Props = {
  events?: GridEvent[];       // allow undefined (route can pass nothing)
  compact?: boolean;
};

export default function GridEventsTable({ events = [], compact = false }: Props) {
  if (!events.length) {
    return (
      <div className="card">
        <div className="text-sm text-gray-600">No events yet.</div>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto bg-white">
      <table className="table min-w-[640px]">
        <thead>
          <tr>
            <th style={{ width: 180 }}>Time</th>
            <th>Device</th>
            <th>Action</th>
            {!compact && <th>Details</th>}
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr key={e.id ?? i}>
              <td>{fmtTime(e.at)}</td>
              <td>{e.device ?? "—"}</td>
              <td>{e.action}</td>
              {!compact && <td className="text-gray-600">{e.details ?? "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtTime(at: string) {
  try {
    const d = new Date(at);
    if (!isFinite(d.getTime())) return at;
    return d.toLocaleString();
  } catch {
    return at;
  }
}
