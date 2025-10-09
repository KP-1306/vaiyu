import { useEffect, useState } from "react";
import "../theme.css";
import { useTheme } from "../components/ThemeProvider";

const API = import.meta.env.VITE_API_URL; // e.g. https://vaiyu-api.onrender.com

type Hotel = { slug:string; name:string; logo_url?:string; address?:string; about?:string; amenities?:string[]; phone?:string; email?:string; theme?:{brand?:string;mode?:"light"|"dark"} };

export default function HotelPage() {
  const [hotel, setHotel] = useState<Hotel|null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("slug") || "vaiyu";
    fetch(`${API}/hotel/${slug}`).then(r=>r.json()).then(d=>{
      setHotel(d); if (d?.theme) setTheme(d.theme);
    }).finally(()=>setLoading(false));
  }, [setTheme]);

  if (loading) return <div style={{padding:24}}>Loading…</div>;
  if (!hotel) return <div style={{padding:24}}>Hotel not found.</div>;

  return (
    <div style={{maxWidth:1000, margin:"0 auto", padding:24}}>
      <header className="grid" style={{gridTemplateColumns:"80px 1fr", alignItems:"center"}}>
        {hotel.logo_url ? <img src={hotel.logo_url} alt="logo" style={{width:64,height:64,borderRadius:12}}/> : <div style={{width:64,height:64,background:"var(--border)",borderRadius:12}}/>}
        <div>
          <h1 style={{margin:"0 0 4px 0"}}>{hotel.name}</h1>
          <div style={{color:"var(--muted)"}}>{hotel.address}</div>
        </div>
      </header>

      <section className="card" style={{marginTop:16}}>
        <h3>About</h3>
        <p style={{marginTop:8}}>{hotel.about || "Welcome!"}</p>
      </section>

      <section className="card" style={{marginTop:16}}>
        <h3>Amenities</h3>
        <div style={{marginTop:8, display:"flex", gap:8, flexWrap:"wrap"}}>
          {(hotel.amenities||[]).map(a => <span key={a} className="card" style={{padding:"6px 10px"}}>{a}</span>)}
        </div>
      </section>

      <section className="grid" style={{gridTemplateColumns:"1fr 1fr", marginTop:16}}>
        <div className="card"><h3>Quick Check-In</h3><QuickCheckin /></div>
        <div className="card"><h3>Guest Reviews</h3><Reviews slug={hotel.slug} /></div>
      </section>

      <footer style={{marginTop:24,color:"var(--muted)"}}>Contact: {hotel.phone} · {hotel.email}</footer>
    </div>
  );
}

function QuickCheckin() {
  const [code,setCode]=useState(""); const [phone,setPhone]=useState("");
  const [msg,setMsg]=useState<string|null>(null); const [resv,setResv]=useState<any>(null);
  const submit = async (e:React.FormEvent) => {
    e.preventDefault(); setMsg(null); setResv(null);
    const r = await fetch(`${API}/checkin`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ code, phone })});
    const d = await r.json(); if (!r.ok) return setMsg(d?.error || "Failed");
    setResv(d); setMsg("Checked in successfully.");
  };
  return (
    <form onSubmit={submit} className="grid" style={{gap:12}}>
      <input className="input" placeholder="Booking Code" value={code} onChange={e=>setCode(e.target.value)} />
      <input className="input" placeholder="Phone (registered)" value={phone} onChange={e=>setPhone(e.target.value)} />
      <button className="btn">Check In</button>
      {msg && <div>{msg}</div>}
      {resv?.room && <div className="card" style={{background:"transparent"}}>Room Assigned: <b>{resv.room.room_no}</b> ({resv.room.room_type})</div>}
    </form>
  );
}

function Reviews({ slug}:{slug:string }) {
  const [items,setItems]=useState<any[]>([]);
  useEffect(()=>{ fetch(`${API}/reviews/${slug}`).then(r=>r.json()).then(setItems).catch(()=>setItems([])); },[slug]);
  if (!items.length) return <div>No reviews yet.</div>;
  return (
    <div className="grid">
      {items.map(r=>(
        <div key={r.id} className="card">
          <div style={{display:"flex",justifyContent:"space-between"}}>
            <div><b>{"⭐".repeat(r.rating)}</b></div>
            {r.verified && <span style={{fontSize:12,color:"var(--muted)"}}>Verified stay</span>}
          </div>
          {r.title && <div style={{marginTop:6,fontWeight:600}}>{r.title}</div>}
          {r.body && <div style={{marginTop:6}}>{r.body}</div>}
          <div style={{marginTop:6,fontSize:12,color:"var(--muted)"}}>
            by {r.guest_name || "Guest"} · {new Date(r.created_at).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  );
}
