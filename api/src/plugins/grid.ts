// api/src/plugins/grid.ts
import type { FastifyPluginAsync } from 'fastify';

type GridMode = 'manual' | 'assist' | 'auto';
type GridSettings = {
  mode: GridMode;
  peak_hours?: string[];
  safety: { min_off_minutes?: number; max_off_minutes?: number; temperature_floor?: number };
};
type DeviceControl = 'advisory'|'plug'|'relay'|'ir'|'bms'|'ocpp';
type DeviceGroup = 'pumps'|'fans'|'laundry'|'kitchen'|'lighting'|'hvac'|'ev';
type Device = {
  id: string; name: string; group?: DeviceGroup; priority: 1|2|3;
  control: DeviceControl; on?: boolean; power_kw?: number; min_off?: number; max_off?: number;
};
type PlayStepAction = 'shed'|'nudge';
type Playbook = {
  id: string; name: string;
  steps: Array<{ device_id: string; do: PlayStepAction; duration_min?: number; restore_after?: boolean }>;
};
type GridEventAction = 'shed'|'restore'|'nudge';
type GridEvent = {
  id: string; start_at: string; end_at?: string; mode: GridMode;
  target_kw: number; reduced_kw?: number;
  actions: Array<{ ts: string; device_id: string; action: GridEventAction; by: 'system'|'staff'|'owner'; note?: string }>;
};

// -------- IN-MEMORY (per-process) DEMO STATE ----------
const seedSettings: GridSettings = {
  mode: 'manual',
  peak_hours: ['18:00-22:00'],
  safety: { min_off_minutes: 20, max_off_minutes: 60, temperature_floor: 23 },
};
let settings = seedSettings;

let devices: Device[] = [
  { id: 'pool-pump', name: 'Pool Pump', group: 'pumps', priority: 1, control: 'advisory', power_kw: 2.2, min_off: 30, max_off: 60, on: true },
  { id: 'laundry', name: 'Laundry Bank', group: 'laundry', priority: 2, control: 'advisory', power_kw: 3.5, min_off: 30, max_off: 90, on: true },
  { id: 'corridor-fans', name: 'Corridor Fans', group: 'fans', priority: 1, control: 'advisory', power_kw: 1.0, min_off: 20, max_off: 45, on: true },
];

let playbooks: Playbook[] = [
  {
    id: 'peak-shed',
    name: 'Peak-Hour Shed',
    steps: [
      { device_id: 'pool-pump', do: 'shed', duration_min: 45, restore_after: true },
      { device_id: 'corridor-fans', do: 'shed', duration_min: 30, restore_after: true },
      { device_id: 'laundry', do: 'shed', duration_min: 60, restore_after: false },
    ],
  },
];

let events: GridEvent[] = [];
const nowIso = () => new Date().toISOString();
const findDevice = (id: string) => devices.find(d => d.id === id);

// naive reduction estimate (manual mode): sum of power for shed devices * hours
function estimateReducedKw(ev: GridEvent): number {
  const shedIds = new Set(
    ev.actions.filter(a => a.action === 'shed').map(a => a.device_id)
  );
  let kw = 0;
  shedIds.forEach(id => {
    const d = findDevice(id);
    if (d?.power_kw) kw += d.power_kw;
  });
  return Number(kw.toFixed(2));
}

const plugin: FastifyPluginAsync = async (f) => {
  // Settings (optional endpoints if you want to expose)
  f.get('/grid/settings', async () => settings);
  f.post('/grid/settings', async (req, rep) => {
    settings = { ...(req.body as GridSettings) };
    return { ok: true, settings };
  });

  // Devices
  f.get('/grid/devices', async () => devices);
  f.post('/grid/devices', async (req, rep) => {
    const body = req.body as Device | Device[];
    const arr = Array.isArray(body) ? body : [body];
    arr.forEach((d) => {
      const i = devices.findIndex(x => x.id === d.id);
      if (i >= 0) devices[i] = { ...devices[i], ...d };
      else devices.push({ ...d });
    });
    return { ok: true, items: devices };
  });

  // Playbooks
  f.get('/grid/playbooks', async () => playbooks);
  f.post('/grid/playbooks', async (req, rep) => {
    const pb = req.body as Playbook | Playbook[];
    const arr = Array.isArray(pb) ? pb : [pb];
    arr.forEach(p => {
      const i = playbooks.findIndex(x => x.id === p.id);
      if (i >= 0) playbooks[i] = { ...playbooks[i], ...p };
      else playbooks.push({ ...p });
    });
    return { ok: true, items: playbooks };
  });

  // Events
  f.post('/grid/events/start', async (req, rep) => {
    const { target_kw, playbook_id }: { target_kw: number; playbook_id?: string } = (req.body as any) || {};
    const ev: GridEvent = {
      id: `ev_${Date.now()}`,
      start_at: nowIso(),
      mode: settings.mode || 'manual',
      target_kw: Number(target_kw) || 0,
      actions: [],
    };
    // If a playbook is provided, log advisory "shed" actions (manual mode asks staff)
    if (playbook_id) {
      const pb = playbooks.find(p => p.id === playbook_id);
      if (pb) {
        pb.steps.forEach(s => {
          ev.actions.push({ ts: nowIso(), device_id: s.device_id, action: 'shed', by: 'system', note: 'playbook' });
        });
      }
    }
    events.unshift(ev);
    return { event: ev };
  });

  f.post('/grid/events/:id/step', async (req, rep) => {
    const { id } = req.params as any;
    const { device_id, action, note }: { device_id: string; action: GridEventAction; note?: string } = (req.body as any) || {};
    const ev = events.find(e => e.id === id);
    if (!ev) return rep.code(404).send({ error: 'event not found' });

    // safety (min/max off) is advisory in manual mode: we just record
    const by: 'system'|'staff'|'owner' = 'staff';
    ev.actions.push({ ts: nowIso(), device_id, action, by, note });

    // change in-memory device state (best-effort)
    const d = findDevice(device_id);
    if (d) {
      if (action === 'shed') d.on = false;
      if (action === 'restore') d.on = true;
    }
    return { event: ev };
  });

  f.post('/grid/events/:id/stop', async (req, rep) => {
    const { id } = req.params as any;
    const ev = events.find(e => e.id === id);
    if (!ev) return rep.code(404).send({ error: 'event not found' });
    ev.end_at = nowIso();
    // estimate reduced_kw (manual mode)
    ev.reduced_kw = estimateReducedKw(ev);
    return { event: ev };
  });

  // Direct device control (manual: log only, no hardware)
  f.post('/grid/device/:id/shed', async (req, rep) => {
    const { id } = req.params as any;
    const d = findDevice(id);
    if (!d) return rep.code(404).send({ error: 'device not found' });
    d.on = false; // in manual: just toggle locally
    return { ok: true };
  });
  f.post('/grid/device/:id/restore', async (req, rep) => {
    const { id } = req.params as any;
    const d = findDevice(id);
    if (!d) return rep.code(404).send({ error: 'device not found' });
    d.on = true;
    return { ok: true };
  });
  f.post('/grid/device/:id/nudge', async (req, rep) => {
    const { id } = req.params as any;
    const d = findDevice(id);
    if (!d) return rep.code(404).send({ error: 'device not found' });
    // manual mode: no-op except logging; return a mock delta
    return { ok: true, delta: 2 };
  });

  // list events (for UI)
  f.get('/grid/events', async () => ({ items: events }));
};

export default plugin;
