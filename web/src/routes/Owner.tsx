import { useEffect, useState } from 'react';
import { getHotel, upsertHotel } from '../lib/api';
import { API } from '../lib/api';

export default function Owner() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState('sunrise');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [amenities, setAmenities] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [brand, setBrand] = useState('#145AF2');
  const [mode, setMode] = useState<'light'|'dark'>('light');

  // reviews policy
  const [policyMode, setPolicyMode] = useState<'off'|'preview'|'auto'>('preview');
  const [minActivity, setMinActivity] = useState(1);
  const [blockLate, setBlockLate] = useState(0);
  const [requireConsent, setRequireConsent] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const h = await getHotel('sunrise');
        setSlug(h.slug || 'sunrise');
        setName(h.name || '');
        setDescription(h.description || '');
        setAddress(h.address || '');
        setAmenities((h.amenities || []).join(', '));
        setPhone(h.phone || '');
        setEmail(h.email || '');
        setBrand(h?.theme?.brand || '#145AF2');
        setMode(h?.theme?.mode || 'light');

        const rp = h.reviews_policy || {};
        setPolicyMode(rp.mode || 'preview');
        setMinActivity(rp.min_activity ?? 1);
        setBlockLate(rp.block_if_late_exceeds ?? 0);
        setRequireConsent(!!rp.require_consent);
      } catch (e) {
        // ignore for first-time setup
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        slug,
        name,
        description,
        address,
        amenities: amenities.split(',').map(s => s.trim()).filter(Boolean),
        phone, email,
        theme: { brand, mode },
        reviews_policy: {
          mode: policyMode,
          min_activity: Number(minActivity),
          block_if_late_exceeds: Number(blockLate),
          require_consent: Boolean(requireConsent)
        }
      };
      await upsertHotel(payload);
      alert('Saved!');
    } catch (err: any) {
      alert(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{padding:20}}>Loading…</div>;

  return (
    <div style={{maxWidth: 900, margin: '20px auto', display: 'grid', gap: 16}}>
      <h2>Owner Settings</h2>
      <form onSubmit={save} className="card" style={{display:'grid', gap:12}}>
        <div style={{display:'grid', gap:6}}>
          <label>Slug</label>
          <input className="input" value={slug} onChange={e=>setSlug(e.target.value)} />
        </div>
        <div style={{display:'grid', gap:6}}>
          <label>Name</label>
          <input className="input" value={name} onChange={e=>setName(e.target.value)} />
        </div>
        <div style={{display:'grid', gap:6}}>
          <label>Description</label>
          <textarea className="input" value={description} onChange={e=>setDescription(e.target.value)} />
        </div>
        <div style={{display:'grid', gap:6}}>
          <label>Address</label>
          <input className="input" value={address} onChange={e=>setAddress(e.target.value)} />
        </div>
        <div style={{display:'grid', gap:6}}>
          <label>Amenities (comma-separated)</label>
          <input className="input" value={amenities} onChange={e=>setAmenities(e.target.value)} />
        </div>
        <div style={{display:'grid', gap:6}}>
          <label>Phone</label>
          <input className="input" value={phone} onChange={e=>setPhone(e.target.value)} />
        </div>
        <div style={{display:'grid', gap:6}}>
          <label>Email</label>
          <input className="input" value={email} onChange={e=>setEmail(e.target.value)} />
        </div>

        <div className="card" style={{display:'grid', gap:10}}>
          <b>Theme</b>
          <div style={{display:'flex', gap:12, alignItems:'center'}}>
            <label style={{minWidth:100}}>Brand color</label>
            <input type="color" className="input" value={brand} onChange={e=>setBrand(e.target.value)} />
            <input className="input" value={brand} onChange={e=>setBrand(e.target.value)} />
          </div>
          <div style={{display:'flex', gap:12, alignItems:'center'}}>
            <label style={{minWidth:100}}>Mode</label>
            <select className="select" value={mode} onChange={e=>setMode(e.target.value as any)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>

        <div className="card" style={{display:'grid', gap:10}}>
          <b>Reviews Policy</b>
          <div style={{display:'grid', gridTemplateColumns:'160px 1fr', gap:10, alignItems:'center'}}>
            <label>Mode</label>
            <select className="select" value={policyMode} onChange={e=>setPolicyMode(e.target.value as any)}>
              <option value="off">Off</option>
              <option value="preview">Preview (draft only)</option>
              <option value="auto">Auto (consent rules apply)</option>
            </select>

            <label>Min activity</label>
            <input className="input" type="number" min={0} value={minActivity} onChange={e=>setMinActivity(parseInt(e.target.value||'0'))} />

            <label>Block if late &gt;</label>
            <input className="input" type="number" min={0} value={blockLate} onChange={e=>setBlockLate(parseInt(e.target.value||'0'))} />

            <label>Require consent</label>
            <select className="select" value={requireConsent ? 'yes' : 'no'} onChange={e=>setRequireConsent(e.target.value==='yes')}>
              <option value="yes">Yes (recommended)</option>
              <option value="no">No</option>
            </select>
          </div>
          <div style={{fontSize:12, color:'var(--muted)'}}>
            Auto never publishes without consent if “Require consent” is ON. Without consent, it will create a private pending draft instead.
          </div>
        </div>

        <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        <div style={{fontSize:12}}>
          API: <code>{API}</code>
        </div>
      </form>
    </div>
  );
}
