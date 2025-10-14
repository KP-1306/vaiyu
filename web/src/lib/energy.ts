export type GridEventRow = {
  id: string;
  deviceId: string;
  deviceName?: string;
  startedAt: string;           // ISO
  endedAt?: string | null;     // ISO or null if ongoing
  action: "shed" | "restore" | string;
  watts?: number | null;       // nominal device power
};

export function minutesBetween(a: string, b?: string | null) {
  const start = new Date(a).getTime();
  const end = b ? new Date(b).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 60000));
}

/** Estimate kWh saved for a shed action over the duration. */
export function estimateKWh(row: GridEventRow) {
  if (row.action !== "shed") return 0;
  const mins = minutesBetween(row.startedAt, row.endedAt);
  const watts = row.watts ?? 0;
  return (watts * (mins / 60)) / 1000; // Wh -> kWh
}

/** Money saved = kWh * tariff. */
export function estimateSavings(row: GridEventRow, tariffPerKWh: number) {
  return +(estimateKWh(row) * tariffPerKWh).toFixed(2);
}
