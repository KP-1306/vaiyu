// api/src/plugins/referrals.ts
import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'crypto';

type RefInitBody = { property: string; channel?: string };
type RefApplyBody = {
  bookingCode: string;
  property?: string; // if omitted, try to infer from booking (optional for MVP)
  referrer: { accountId?: string; phone?: string; email?: string };
};
type RedeemBody = { property: string; amount: number; context?: any };

const SITE_ORIGIN = process.env.PUBLIC_SITE_ORIGIN || 'https://vaiyu.co.in';
const CURRENCY = process.env.CREDITS_CURRENCY || 'INR';
const REFERRAL_BONUS_CREDITS = Number(process.env.REFERRAL_BONUS_CREDITS || 500);

const referralsPlugin: FastifyPluginAsync = async (fastify) => {
  // ---- Helpers -------------------------------------------------------------
  function genCode(property: string) {
    const pad = randomBytes(3).toString('hex').slice(0, 6).toUpperCase(); // e.g. "A1B2C3"
    return `${(property || 'PROP').slice(0, 3).toUpperCase()}-${pad}`;
  }

  async function getUserIdFromToken(authHeader?: string): Promise<string | null> {
    if (!authHeader) return null;
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const token = m[1];

    // MVP: accept demo token; plug in your real auth/JWT here
    if (token === 'demo-stay-token') return 'user_demo';

    // Example for JWT (uncomment and add @fastify/jwt if you have it)
    // try {
    //   const payload = fastify.jwt.verify(token) as any;
    //   return payload?.sub || payload?.user_id || null;
    // } catch { return null; }

    // If you have a sessions table, resolve here.
    return null;
  }

  async function resolveReferrerUserId(ref: RefApplyBody['referrer'], client: any): Promise<string | null> {
    if (!ref) return null;
    if (ref.accountId) return ref.accountId;

    if (ref.phone) {
      const { rows } = await client.query(
        `SELECT user_id FROM guest_identities WHERE phone = $1 LIMIT 1`, [ref.phone]
      );
      return rows[0]?.user_id ?? null;
    }
    if (ref.email) {
      const { rows } = await client.query(
        `SELECT user_id FROM guest_identities WHERE email = $1 LIMIT 1`, [ref.email]
      );
      return rows[0]?.user_id ?? null;
    }
    return null;
  }

  // ---- Routes --------------------------------------------------------------

  /**
   * POST /referrals/init
   * body: { property, channel? }
   * auth: optional (if present, we store created_by_user_id)
   * returns: { ok, code, shareUrl }
   */
  fastify.post<{ Body: RefInitBody }>('/referrals/init', async (req, reply) => {
    const { property, channel } = req.body || {};
    if (!property) return reply.code(400).send({ error: 'property is required' });

    const userId = await getUserIdFromToken(req.headers.authorization);
    const code = genCode(property);

    const client = await fastify.pg.connect();
    try {
      await client.query('BEGIN');

      // Ensure property exists (optional; remove if you already guarantee this)
      await client.query(
        `INSERT INTO properties(slug, name) VALUES ($1, $1)
         ON CONFLICT (slug) DO NOTHING`,
        [property]
      );

      await client.query(
        `INSERT INTO referrals(property, code, created_by_user_id)
         VALUES ($1, $2, $3)`,
        [property, code, userId]
      );

      await client.query('COMMIT');
    } catch (e: any) {
      await client.query('ROLLBACK');
      req.log.error({ err: e }, 'referrals/init failed');
      // If the code collided (rare), just return 409; client can retry
      if (String(e?.message || '').includes('duplicate key')) {
        return reply.code(409).send({ error: 'Duplicate referral code. Retry.' });
      }
      return reply.code(500).send({ error: 'Failed to create referral' });
    } finally {
      client.release();
    }

    const shareUrl = `${SITE_ORIGIN}/hotel/${encodeURIComponent(property)}?ref=${encodeURIComponent(code)}`;
    return { ok: true, code, shareUrl, channel: channel || null };
  });

  /**
   * POST /referrals/apply
   * body: { bookingCode, property?, referrer: { accountId|phone|email } }
   * idempotent on (property, bookingCode)
   * returns: { ok, award: { delta, property } }
   */
  fastify.post<{ Body: RefApplyBody }>('/referrals/apply', async (req, reply) => {
    const { bookingCode, property, referrer } = req.body || {};
    if (!bookingCode) return reply.code(400).send({ error: 'bookingCode is required' });
    if (!referrer || !(referrer.accountId || referrer.phone || referrer.email)) {
      return reply.code(400).send({ error: 'referrer identifier required' });
    }

    // In a richer system, you'd infer property from bookingCode here if not provided.
    const prop = property || 'sunrise';

    const client = await fastify.pg.connect();
    try {
      await client.query('BEGIN');

      // Resolve referrer user_id
      const refUserId = await resolveReferrerUserId(referrer, client);
      if (!refUserId) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'Referrer not found' });
      }

      // Ensure property exists
      await client.query(
        `INSERT INTO properties(slug, name) VALUES ($1, $1)
         ON CONFLICT (slug) DO NOTHING`,
        [prop]
      );

      // Idempotency: unique (property, booking_code)
      await client.query(
        `INSERT INTO referral_rewards(property, booking_code, referrer_user_id, amount, meta)
         VALUES ($1, $2, $3, $4, $5)`,
        [prop, bookingCode, refUserId, REFERRAL_BONUS_CREDITS, { via: 'api', at: new Date().toISOString() }]
      );

      // Credit the referrer
      await client.query(
        `INSERT INTO credits_ledger(property, user_id, booking_code, delta, reason, meta)
         VALUES ($1, $2, $3, $4, 'referral_bonus', $5)`,
        [prop, refUserId, bookingCode, REFERRAL_BONUS_CREDITS, { source: 'referral_rewards' }]
      );

      await client.query('COMMIT');
      return reply.send({ ok: true, award: { delta: REFERRAL_BONUS_CREDITS, property: prop, currency: CURRENCY } });
    } catch (e: any) {
      await client.query('ROLLBACK');
      req.log.error({ err: e }, 'referrals/apply failed');
      if (String(e?.message || '').includes('duplicate key value violates unique constraint')) {
        // Booking already rewarded for this property
        return reply.code(409).send({ error: 'Referral already applied for this booking/property' });
      }
      return reply.code(500).send({ error: 'Failed to apply referral' });
    } finally {
      client.release();
    }
  });

  /**
   * GET /credits/mine
   * auth: Bearer token → user_id
   * returns: { items: [{ property, balance, currency, expiresAt }], total }
   */
  fastify.get('/credits/mine', async (req, reply) => {
    const userId = await getUserIdFromToken(req.headers.authorization);
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const { rows } = await fastify.pg.query(
      `SELECT property, balance::int AS balance
       FROM credit_balances
       WHERE user_id = $1
       ORDER BY property ASC`,
      [userId]
    );

    const items = rows.map((r: any) => ({
      property: r.property,
      balance: r.balance,
      currency: CURRENCY,
      expiresAt: null as string | null, // add real expiry logic later if needed
    }));

    const total = items.reduce((a, b) => a + (b.balance || 0), 0);
    return { items, total };
  });

  /**
   * POST /credits/redeem
   * body: { property, amount, context? }
   * auth: Bearer token
   * returns: { ok, newBalance }
   */
  fastify.post<{ Body: RedeemBody }>('/credits/redeem', async (req, reply) => {
    const userId = await getUserIdFromToken(req.headers.authorization);
    if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

    const { property, amount, context } = req.body || {};
    const amt = Number(amount);
    if (!property || !Number.isFinite(amt) || amt <= 0) {
      return reply.code(400).send({ error: 'property and positive amount required' });
    }

    const client = await fastify.pg.connect();
    try {
      await client.query('BEGIN');

      // Check balance
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(delta), 0)::int AS balance
         FROM credits_ledger
         WHERE property = $1 AND user_id = $2`,
        [property, userId]
      );
      const balance = rows[0]?.balance ?? 0;
      if (balance < amt) {
        await client.query('ROLLBACK');
        return reply.code(400).send({ error: 'Insufficient credits', balance });
      }

      // Deduct
      await client.query(
        `INSERT INTO credits_ledger(property, user_id, delta, reason, meta)
         VALUES ($1, $2, $3, 'redemption', $4)`,
        [property, userId, -amt, { context: context ?? null }]
      );

      // New balance
      const { rows: post } = await client.query(
        `SELECT COALESCE(SUM(delta), 0)::int AS balance
         FROM credits_ledger
         WHERE property = $1 AND user_id = $2`,
        [property, userId]
      );
      await client.query('COMMIT');
      return { ok: true, newBalance: post[0]?.balance ?? 0, currency: CURRENCY };
    } catch (e: any) {
      await client.query('ROLLBACK');
      req.log.error({ err: e }, 'credits/redeem failed');
      return reply.code(500).send({ error: 'Failed to redeem credits' });
    } finally {
      client.release();
    }
  });
};

export default referralsPlugin;
