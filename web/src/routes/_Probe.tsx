// web/src/routes/_Probe.tsx
export default function Probe() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Guest route is alive ✅</h1>
      <p>Router + layout are fine. If this renders, the issue is in GuestDashboard (or what it imports).</p>
    </div>
  );
}
