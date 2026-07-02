// web/src/routes/owner/SiteEditor.tsx
//
// Public-website editor for one hotel. Same component powers two routes:
//   - owner:    /owner/:slug/website        (member/manager edits their site)
//   - platform: /admin/platform/hotels/:slug/site  (VAiyu seeds any hotel)
//
// Edits the hotel_sites draft columns + picks the hero from the DAM gallery,
// then Preview (assembles via the site-publish fn, renders the real luxury
// template into an iframe) and Publish (gated: ACTIVE + copy + a hero photo).
// Photos live in the DAM (/owner/:slug/assets) — this only *picks* them.

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ChevronLeft, Loader2, Eye, Send, Check, ExternalLink, X,
  AlertTriangle, Camera, Globe,
} from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { SUPABASE_PUBLISHABLE_KEY } from '../../lib/supabaseKey';
import { renderSiteHTML } from '../../../scripts/siteTemplate.mjs';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SITE_BASE = (import.meta.env.VITE_SITE_BASE as string) || 'https://vaiyu.co.in';

interface Hotel { id: string; name: string; slug: string; brand_color?: string | null; }
interface Photo { id: string; url: string; alt: string; code: string; }
type Msg = { kind: 'ok' | 'err'; text: string } | { kind: 'gate'; missing: string[] } | null;

const EMPTY = {
  tagline: '', about_md: '', dining_intro: '', experiences_intro: '', location_intro: '',
  seo_title: '', seo_description: '', cta_mode: 'enquire', hero_asset_file_id: '',
};

export default function SiteEditor({ platform = false }: { platform?: boolean }) {
  const { slug: rawSlug } = useParams();
  const slug = (rawSlug ?? '').trim();

  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [status, setStatus] = useState<string>('DRAFT');
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [f, setF] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<null | 'preview' | 'publish' | 'unpublish'>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setNotFound(false);
      const { data: h } = await supabase.from('hotels').select('id,name,slug,brand_color').eq('slug', slug).maybeSingle();
      if (cancel) return;
      if (!h) { setNotFound(true); setLoading(false); return; }
      setHotel(h as Hotel);
      const [{ data: s }, { data: files }] = await Promise.all([
        supabase.from('hotel_sites').select('*').eq('hotel_id', h.id).maybeSingle(),
        supabase.from('hotel_asset_files')
          .select('id,storage_path,alt_text,hotel_assets!inner(requirement_code)')
          .eq('hotel_id', h.id).eq('bucket', 'hotel-assets'),
      ]);
      if (cancel) return;
      if (s) {
        setStatus(s.status || 'DRAFT');
        setPublishedAt(s.published_at ?? null);
        setF({
          tagline: s.tagline ?? '', about_md: s.about_md ?? '', dining_intro: s.dining_intro ?? '',
          experiences_intro: s.experiences_intro ?? '', location_intro: s.location_intro ?? '',
          seo_title: s.seo_title ?? '', seo_description: s.seo_description ?? '',
          cta_mode: s.cta_mode ?? 'enquire', hero_asset_file_id: s.hero_asset_file_id ?? '',
        });
      }
      setPhotos((files ?? []).map((x: any) => ({
        id: x.id,
        alt: x.alt_text ?? '',
        code: x.hotel_assets?.requirement_code ?? '',
        url: supabase.storage.from('hotel-assets').getPublicUrl(x.storage_path).data.publicUrl,
      })));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [slug]);

  const set = (k: keyof typeof EMPTY, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save(): Promise<boolean> {
    if (!hotel) return false;
    setSaving(true); setMsg(null);
    const { error } = await supabase.from('hotel_sites').upsert({
      hotel_id: hotel.id,
      tagline: f.tagline || null, about_md: f.about_md || null,
      dining_intro: f.dining_intro || null, experiences_intro: f.experiences_intro || null,
      location_intro: f.location_intro || null, seo_title: f.seo_title || null,
      seo_description: f.seo_description || null, cta_mode: f.cta_mode,
      hero_asset_file_id: f.hero_asset_file_id || null,
    }, { onConflict: 'hotel_id' });
    setSaving(false);
    if (error) { setMsg({ kind: 'err', text: error.message }); return false; }
    return true;
  }

  async function callFn(action: 'preview' | 'publish' | 'unpublish') {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/site-publish`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ hotel_id: hotel!.id, action }),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  async function onPreview() {
    if (!(await save())) return;
    setBusy('preview'); setMsg(null); setPreviewHtml(null);
    const { status: st, json } = await callFn('preview');
    setBusy(null);
    if (st === 200 && json.payload) setPreviewHtml(renderSiteHTML(json.payload));
    else setMsg({ kind: 'err', text: json.error || 'Preview failed' });
  }

  async function onPublish() {
    if (!(await save())) return;
    setBusy('publish'); setMsg(null);
    const { status: st, json } = await callFn('publish');
    setBusy(null);
    if (st === 200 && json.ok) { setMsg({ kind: 'ok', text: `Published — live at ${json.url}` }); setStatus('PUBLISHED'); setPublishedAt(new Date().toISOString()); }
    else if (st === 422) setMsg({ kind: 'gate', missing: json.missing || [] });
    else setMsg({ kind: 'err', text: json.error || 'Publish failed' });
  }

  async function onUnpublish() {
    setBusy('unpublish'); setMsg(null);
    const { status: st, json } = await callFn('unpublish');
    setBusy(null);
    if (st === 200 && json.ok) { setMsg({ kind: 'ok', text: 'Unpublished — removed from the live site on next build.' }); setStatus('DRAFT'); }
    else setMsg({ kind: 'err', text: json.error || 'Unpublish failed' });
  }

  const back = platform ? '/admin/platform' : `/owner/${slug}`;

  if (loading) {
    return (
      <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-400">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-10">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </div>
      </main>
    );
  }
  if (notFound || !hotel) {
    return (
      <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-300">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-300">Hotel not found.</p>
        </div>
      </main>
    );
  }

  const inputCls = 'w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-[14px] text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400';
  const labelCls = 'block text-[12px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5';
  const cardCls = 'rounded-xl border border-slate-800 bg-[#0F1320] p-5';

  const statusChip = {
    PUBLISHED: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
    DRAFT: 'border-slate-600 bg-slate-500/15 text-slate-300',
    SUSPENDED: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  }[status] || 'border-slate-600 bg-slate-500/15 text-slate-300';

  return (
    <main className="vaiyu-owner min-h-screen bg-[#0B0E14] text-slate-100">
      <div className="mx-auto max-w-5xl px-3 py-5 sm:px-4 sm:py-6">
        {/* header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link to={back} className="inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-200">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> {platform ? 'Operator Console' : 'Back to dashboard'}
          </Link>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${statusChip}`}>{status}</span>
            {status === 'PUBLISHED' && (
              <a href={`${SITE_BASE}/${hotel.slug}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[12px] text-indigo-300 hover:text-indigo-200">
                View live <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            )}
          </div>
        </div>

        <header className="mb-5 flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-500/15 text-indigo-300"><Globe className="h-5 w-5" aria-hidden /></div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">Public website</p>
            <h1 className="text-xl font-semibold text-slate-100">{hotel.name}</h1>
          </div>
        </header>

        {platform && (
          <div className="mb-4 rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-[12px] text-indigo-200">
            You're editing this hotel's site as a VAiyu operator (seed mode). The owner can refine it later from their dashboard.
          </div>
        )}

        {/* message banner */}
        {msg?.kind === 'ok' && <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-200"><Check className="h-4 w-4" aria-hidden />{msg.text}</div>}
        {msg?.kind === 'err' && <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-300"><AlertTriangle className="h-4 w-4" aria-hidden />{msg.text}</div>}
        {msg?.kind === 'gate' && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden /> Not ready to publish yet:</div>
            <ul className="ml-6 list-disc space-y-0.5">{msg.missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}

        {/* action bar */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-4 py-2 text-[13px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />} Save draft
          </button>
          <button type="button" onClick={onPreview} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/60 px-4 py-2 text-[13px] font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />} Preview
          </button>
          <button type="button" onClick={onPublish} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-[13px] font-medium text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50">
            {busy === 'publish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />} {status === 'PUBLISHED' ? 'Re-publish' : 'Publish'}
          </button>
          {status === 'PUBLISHED' && (
            <button type="button" onClick={onUnpublish} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-50">
              {busy === 'unpublish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} Unpublish
            </button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* left: copy */}
          <div className="space-y-4">
            <div className={cardCls}>
              <label className={labelCls}>Tagline</label>
              <input className={inputCls} value={f.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={200} placeholder="A Himalayan hideaway above the lake." />
              <label className={`${labelCls} mt-4`}>About</label>
              <textarea className={inputCls} rows={5} value={f.about_md} onChange={(e) => set('about_md', e.target.value)} maxLength={8000} placeholder="Tell the story of the property. Blank lines start new paragraphs." />
            </div>

            <div className={cardCls}>
              <label className={labelCls}>Dining intro</label>
              <textarea className={inputCls} rows={2} value={f.dining_intro} onChange={(e) => set('dining_intro', e.target.value)} maxLength={2000} placeholder="What's the food experience like?" />
              <label className={`${labelCls} mt-4`}>Experiences intro</label>
              <textarea className={inputCls} rows={2} value={f.experiences_intro} onChange={(e) => set('experiences_intro', e.target.value)} maxLength={2000} placeholder="Things to do, arranged by the hotel." />
              <label className={`${labelCls} mt-4`}>Location intro</label>
              <textarea className={inputCls} rows={2} value={f.location_intro} onChange={(e) => set('location_intro', e.target.value)} maxLength={2000} placeholder="Getting here — landmarks, distance from the station." />
            </div>

            <div className={cardCls}>
              <label className={labelCls}>Booking call-to-action</label>
              <select className={inputCls} value={f.cta_mode} onChange={(e) => set('cta_mode', e.target.value)}>
                <option value="enquire">Enquiry form (VAiyu lead capture)</option>
                <option value="booking_url">External booking link (hotel's booking_url)</option>
              </select>
              <label className={`${labelCls} mt-4`}>SEO title <span className="text-slate-500 normal-case">(optional — falls back to the hotel name)</span></label>
              <input className={inputCls} value={f.seo_title} onChange={(e) => set('seo_title', e.target.value)} maxLength={70} />
              <label className={`${labelCls} mt-4`}>SEO description <span className="text-slate-500 normal-case">(optional)</span></label>
              <textarea className={inputCls} rows={2} value={f.seo_description} onChange={(e) => set('seo_description', e.target.value)} maxLength={200} />
            </div>
          </div>

          {/* right: hero picker */}
          <div className="space-y-4">
            <div className={cardCls}>
              <div className="mb-3 flex items-center justify-between">
                <label className={`${labelCls} mb-0`}>Hero photo</label>
                <Link to={`/owner/${slug}/assets`} className="inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200"><Camera className="h-3 w-3" aria-hidden /> Manage photos</Link>
              </div>
              {photos.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-700 bg-slate-950/40 px-3 py-6 text-center text-[12px] text-slate-400">
                  No photos yet. Upload them in <Link to={`/owner/${slug}/assets`} className="text-indigo-300 underline">Digital Assets</Link> first — the hero comes from there.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {photos.map((p) => (
                    <button key={p.id} type="button" onClick={() => set('hero_asset_file_id', p.id === f.hero_asset_file_id ? '' : p.id)}
                      className={`relative aspect-[4/3] overflow-hidden rounded-md border-2 ${p.id === f.hero_asset_file_id ? 'border-indigo-400' : 'border-transparent hover:border-slate-600'}`}
                      title={p.alt || p.code} aria-pressed={p.id === f.hero_asset_file_id}>
                      <img src={p.url} alt={p.alt} className="h-full w-full object-cover" loading="lazy" />
                      {p.id === f.hero_asset_file_id && <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-indigo-500 text-white"><Check className="h-2.5 w-2.5" aria-hidden /></span>}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-500">The rest of the gallery, rooms, dining &amp; experience photos are pulled from Digital Assets automatically.</p>
            </div>
            {publishedAt && <p className="px-1 text-[11px] text-slate-500">Last published {new Date(publishedAt).toLocaleString('en-IN')}</p>}
          </div>
        </div>
      </div>

      {/* preview overlay */}
      {previewHtml !== null && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80" role="dialog" aria-modal="true">
          <div className="flex items-center justify-between border-b border-slate-800 bg-[#0B0E14] px-4 py-2">
            <span className="text-[12px] font-semibold uppercase tracking-widest text-slate-400">Preview — {hotel.name}</span>
            <button type="button" onClick={() => setPreviewHtml(null)} className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/60 px-3 py-1 text-[12px] text-slate-200 hover:bg-slate-800">
              <X className="h-3.5 w-3.5" aria-hidden /> Close
            </button>
          </div>
          <iframe title="Site preview" className="flex-1 border-0 bg-white" srcDoc={previewHtml} />
        </div>
      )}
    </main>
  );
}
