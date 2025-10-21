// web/src/routes/staff/StaffHome.tsx
import { Link } from "react-router-dom";

export default function StaffHome() {
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold">Staff Workspace</h1>
      <p className="text-gray-600 mt-1">Your day at a glance.</p>

      <div className="grid md:grid-cols-3 gap-4 mt-6">
        <Card title="Front Desk" to="/desk" kpi="2 due • 1 overdue" />
        <Card title="Housekeeping" to="/hk" kpi="3 rooms • 1 nudge" />
        <Card title="Maintenance" to="/maint" kpi="1 open ticket" />
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-6">
        <Card title="My Attendance" to="/staff/attendance" kpi="Not checked in" />
        <Card title="Request Leave" to="/staff/leave" kpi="Pending: 0" />
      </div>
    </div>
  );
}

function Card({ title, to, kpi }: { title: string; to: string; kpi: string }) {
  return (
    <Link to={to} className="rounded-2xl p-5 border bg-white shadow hover:shadow-md transition">
      <div className="text-lg font-medium">{title}</div>
      <div className="text-sm text-gray-600 mt-1">{kpi}</div>
    </Link>
  );
}
