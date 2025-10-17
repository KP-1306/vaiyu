// web/src/routes/WalkInCheckin.tsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function WalkInCheckin() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [code, setCode] = useState(sp.get("code") || "");

  async function startWithCode() {
    const c = code.trim().toUpperCase();
    if (!c || c.length < 4) return;
    const { data, error } = await supabase.functions.invoke("walkin_start", {
      body: { hotel_code: c },
    });
    if (error || !data?.redirect) {
      alert("Could not start walk-in; please ask the front desk.");
      return;
    }
    nav(data.redirect);
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="text-lg font-semibold">Walk-in check-in</h1>
      <p className="text-sm text-gray-600">Scan the property QR or enter the hotel code.</p>

      {/* If/when you add a scanner: <QRScanner onResult={({slug,token}) => nav(`/precheck?hotel=${slug}&token=${token}`)} /> */}

      <div className="card">
        <label className="text-sm font-medium">Hotel code</label>
        <input className="input mt-1" value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="e.g. SUN123"/>
        <button className="btn mt-2 w-full" onClick={startWithCode}>Continue</button>
      </div>
    </main>
  );
}
