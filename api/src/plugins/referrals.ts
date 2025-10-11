import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';

type Ctx = {
  db: Pool;
  appOrigin: string;
  referralBonusAmount: number; // integer (minor units / points)
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string }; // set by your auth hook/JWT
  }
}

function genCode(property: string) {
  const r = randomBytes(3).toString('hex').toUpperCase(); // 6 chars
  return `${property.slice(0,3).toUpperCase()}-${r}`;
}

export const referralsPlugin: FastifyPluginAsync<Ctx> = async (app, opts) => {
  const { db, appOrigin, referralBonusAmount } = opts;

  // Helpers
  async function ensureProperty(slug: string) {
    await db.query('INSERT INTO properties(slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING', [slug]);
  }

  async function getOrCreateUserIdByIdentity(identity: { accountId?: string; phone?: string; email?: string; }) {
    if (identity.accountId) return identity.accountId;

    if (identity.phone) {
      const q = await db.query('SELECT user_id FROM guest_identities WHERE phone = $1', [identity.phone]);
      if (q.rowCount) return q.rows[0].user_id;
      // create a synthetic user id for phone-only referrals (or map to your auth)
      const newId = `phone_${identity.phone}`;
      await db.query(
        'INSERT INTO guest_identities(user_id, phone) VALUES ($1,$2) ON CONFLICT (phone) DO NOTHING',
        [newId, identity.phone]
      );
      return newId;
    }

    if (identity.email) {
      const q = await db.query('SELECT user_id FROM guest_identities WHERE email = $1', [identity.email]);
      if (q.rowCount) return q.rows[0].user_id;
      const newId = `email_${identity.email}`;
      await db.query(
        'INSERT INTO guest_identities(user_id, email) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING',
        [newId, identity.email]
      );
      return newId;
    }

    throw new Error('No valid identity provided');
  }

  // POST /referrals/init { property }
  app.post<{
    Body: { property: string; channel?: string };
  }>('/referrals/init', async (req, reply) => {
    const { property, channel } = req.body || {};
    if (!property) return reply.code(400).send({ error: 'property required' });

    await ensureProperty(property);

    const code = genCode(property);
    await db.query(
      `INSERT INTO referrals(property, code, created_by_user_id)
       VALUES ($1,$2,$3)`,
      [property, code, req.user?.id || null]
    );

    const shareUrl = `${appOrigin.replace(/\/+$/,'')}/hotel/${encodeURIComponent(property)}?ref=${encodeURIComponent(code)}`;

    return reply.send({
      ok: true,
      code,
      shareUrl,
      channel: channel || 'guest_dashboard'
    });
  });

  // POST /referrals/apply
  // { bookingCode, property?, referrer: { accountId|phone|email } }
  app.post<{
    Body: {
      bookingCode: string;
      property?: string; // optional; if omitted you can derive from booking in your system
      referrer: { accountId?: string; phone?: string; email?: string };
      meta?: Record<string, any>;
    };
  }>('/referrals/apply', async (req, reply) => {
    const { bookingCode, property, referrer, meta } = req.body || {};
    if (!bookingCode || !referrer) return reply.code(400).send({ error: 'bookingCode and referrer required' });

    const prop = property || 'sunrise'; // TODO: derive from booking if you have that API
    await ensureProperty(prop);

    const refUserId = await getOrCreateUserIdByIdentity(referrer);

    // Idempotency: one reward per (property, bookingCode)
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const exists = await client.query(
        'SELECT 1 FROM referral_rewards WHERE property=$1 AND booking_code=$2',
        [prop, bookingCode]
      );
      if (!exists.rowCount) {
        // Insert reward record
        await client.query(
          `INSERT INTO referral_rewards(property, booking_code, referrer_user_id, amount, meta)
           VALUES ($1,$2,$3,$4,$5)`,
          [prop, bookingCode, refUserId, referralBonusAmount, meta || {}]
        );

        // Credit the referrer in ledger
        await client.query(
          `INSERT INTO credits_ledger(property, user_id, booking_code, delta, reason, meta)
           VALUES ($1,$2,$3,$4,'referral_bonus',$5)`,
          [prop, refUserId, bookingCode, referralBonusAmount, meta || {}]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return reply.send({ ok: true, status: 'pending_or_awarded' });
  });

  // GET /credits/mine  (Bearer)
  app.get('/credits/mine', async (req, reply) => {
    if (!req.user?.id) return reply.code(401).send({ error: 'unauthorized' });

    const q = await db.query(
      `SELECT property, COALESCE(balance,0)::int AS balance
         FROM credit_balances
        WHERE user_id = $1
      UNION
       SELECT slug AS property, 0 AS balance FROM properties
        WHERE slug NOT IN (SELECT property FROM credit_balances WHERE user_id=$1)`,
      [req.user.id]
    );

    // You can add currency/expiresAt via a settings table; hard-code for now
    const items = q.rows.map(r => ({
      property: r.property,
      balance: Number(r.balance),
      currency: 'INR',
      expiresAt: null as string | null
    }));

    const total = items.reduce((a,b) => a + b.balance, 0);
    return reply.send({ items, total });
  });

  // POST /credits/redeem { property, amount, context }
  app.post<{
    Body: { property: string; amount: number; context?: any };
  }>('/credits/redeem', async (req, reply) => {
    if (!req.user?.id) return reply.code(401).send({ error: 'unauthorized' });

    const { property, amount, context } = req.body || {};
    if (!property || !Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: 'property and positive amount required' });
    }

    // Check balance ≥ amount
    const q = await db.query(
      `SELECT COALESCE(SUM(delta),0)::int AS balance
         FROM credits_ledger
        WHERE user_id=$1 AND property=$2`,
      [req.user.id, property]
    );
    const balance = Number(q.rows[0]?.balance ?? 0);
    if (balance < amount) return reply.code(400).send({ error: 'insufficient_credits', balance });

    // Write redemption (negative delta)
    await db.query(
      `INSERT INTO credits_ledger(property, user_id, delta, reason, meta)
       VALUES ($1,$2,$3,'redemption',$4)`,
      [property, req.user.id, -Math.floor(amount), context || {}]
    );

    const after = balance - Math.floor(amount);
    return reply.send({ ok: true, newBalance: after });
  });
};

export default referralsPlugin;
