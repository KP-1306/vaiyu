import { useState } from "react";
import { Link } from "react-router-dom";
import { API } from "../lib/api";

export default function OwnerRegister() {
  const [form, setForm] = useState({ hotel_name: "", city: "", contact_name: "", contact_email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true); setOk(null); setErr(null);
    try {
      const r = await fetch(`${API}/owner/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error("Could not submit application");
      setOk("Thanks! We’ve received your details. Our team will review and contact you.");
      setForm({ hotel_name: "", city: "", contact_name: "", contact_email: "" });
    } catch (e: any) {
      setErr(e?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Register your property</h1>
      <p className="text-sm text-gray-600">Tell us a bit about your hotel. We’ll review and help complete the formalities.</p>

      {ok && <div className="rounded-md bg-green-50 text-green-800 p-3 text-sm">{ok}</div>}
      {err && <div className="rounded-md bg-red-50 text-red-700 p-3 text-sm">{err}</div>}

      <form className="space-y-3" onSubmit={onSubmit}>
        <div>
          <label className="block text-sm font-medium">Hotel name</label>
          <input className="mt-1 w-full rounded-lg border px-3 py-2" required
            value={form.hotel_name} onChange={e=>setForm({...form, hotel_name:e.target.value})}/>
        </div>
        <div>
          <label className="block text-sm font-medium">City</label>
          <input className="mt-1 w-full rounded-lg border px-3 py-2" required
            value={form.city} onChange={e=>setForm({...form, city:e.target.value})}/>
        </div>
        <div>
          <label className="block text-sm font-medium">Your name</label>
          <input className="mt-1 w-full rounded-lg border px-3 py-2" required
            value={form.contact_name} onChange={e=>setForm({...form, contact_name:e.target.value})}/>
        </div>
        <div>
          <label className="block text-sm font-medium">Work email</label>
          <input type="email" className="mt-1 w-full rounded-lg border px-3 py-2" required
            value={form.contact_email} onChange={e=>setForm({...form, contact_email:e.target.value})}/>
        </div>

        <button className="btn w-full" type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit for approval"}
        </button>
      </form>

      <div className="text-sm text-gray-600">
        Changed your mind? <Link to="/" className="underline">Go back</Link>
      </div>
    </main>
  );
}
