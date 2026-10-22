const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
// Shared with the page: interest/prompt lists, validation, completeness.
const ProfileSchema = require('./public/js/profile-schema.js');
// Shared with the page: privacy defaults and rules, report reasons.
const Safety = require('./public/js/safety.js');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// Optional SMTP configuration for verification codes. Without it email
// verification reports "unavailable" in production; staging previews fall
// back to showing the code inline so the flow stays testable. Both keys are
// optional app secrets (dapp.json) — never hardcoded, never blocking.
const SMTP_URL = process.env.SMTP_URL || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Omichat <no-reply@omichat.local>';

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ------------------------------------------------------------ verification
// The app's first persisted feature: per-account verification state, keyed
// to the platform user id from the JWT (mock profiles stay mock). Email
// confirmation is the baseline tier; a reviewer-checked selfie is the
// optional higher tier.

const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

let dbReady = false;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sixDigitCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

// Placeholder "selfie" for the staging reviewer queue: platform-staged files
// are not cloned into staging, so seeded rows must carry a data-URI image.
function demoPhotoSvg(fill) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">' +
    '<rect width="300" height="300" fill="' + fill + '"/>' +
    '<circle cx="150" cy="115" r="42" fill="#0f172a" opacity="0.2"/>' +
    '<path d="M62 300 C62 215 105 178 150 178 C195 178 238 215 238 300 Z" fill="#0f172a" opacity="0.2"/>' +
    '<text x="150" y="288" font-family="system-ui" font-size="14" fill="#ffffff" text-anchor="middle" opacity="0.75">Staging demo</text>' +
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

async function ensureSchema() {
  if (!process.env.DATABASE_URL) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_verification (
      user_id               TEXT PRIMARY KEY,
      username              TEXT NOT NULL,
      email                 TEXT,
      email_code_hash       TEXT,
      email_code_expires_at TIMESTAMPTZ,
      email_code_attempts   INT NOT NULL DEFAULT 0,
      email_verified_at     TIMESTAMPTZ,
      photo_file_id         TEXT,
      photo_url             TEXT,
      photo_status          TEXT NOT NULL DEFAULT 'none',
      photo_submitted_at    TIMESTAMPTZ,
      photo_reviewed_at     TIMESTAMPTZ,
      photo_note            TEXT,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  // Emails and submitted selfies are personal information: staging copies
  // the schema only, and previews seed their own fake rows below.
  await pool.query(`COMMENT ON TABLE user_verification IS 'staging:private'`);
  if (IS_STAGING) {
    // Seed ONLY the reviewer queue, for fake identities — never the visitor.
    // The unverified state IS the natural empty-database answer, so the
    // visitor's own row is never seeded.
    const demo = [
      ['staging-demo-user-1', 'Staging demo user 1', '#7c3aed'],
      ['staging-demo-user-2', 'Staging demo user 2', '#2563eb'],
    ];
    for (const [id, username, fill] of demo) {
      await pool.query(
        `INSERT INTO user_verification (user_id, username, photo_url, photo_status, photo_submitted_at)
         VALUES ($1, $2, $3, 'pending', now())
         ON CONFLICT (user_id) DO NOTHING`,
        [id, username, demoPhotoSvg(fill)]);
    }
  }
  // The viewer's own editable profile, keyed to the platform user id. Jobs,
  // education and social handles are personal information, so staging
  // copies the schema only. Nothing is seeded: an empty profile IS what a
  // new account sees, and the completeness hints start from there.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id    TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`COMMENT ON TABLE profiles IS 'staging:private'`);
  // Safety, saved per account. Who blocked whom, report notes and message
  // snapshots, and privacy choices are all personal: staging copies the
  // schema only. Targets are keys: `mock:<id>` for sample profiles,
  // `user:<platform id>` for real accounts.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id   TEXT NOT NULL,
      blocked_key  TEXT NOT NULL,
      blocked_name TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (blocker_id, blocked_key)
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS blocks_blocked_key_idx ON blocks (blocked_key)');
  await pool.query(`COMMENT ON TABLE blocks IS 'staging:private'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id                SERIAL PRIMARY KEY,
      reporter_id       TEXT NOT NULL,
      reporter_username TEXT NOT NULL,
      target_type       TEXT NOT NULL,
      target_key        TEXT NOT NULL,
      target_name       TEXT,
      message_id        TEXT,
      message_text      TEXT,
      reason            TEXT NOT NULL,
      note              TEXT NOT NULL DEFAULT '',
      status            TEXT NOT NULL DEFAULT 'open',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at       TIMESTAMPTZ,
      reviewed_by       TEXT
    )`);
  // One open report per reporter per person or message.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_idx
    ON reports (reporter_id, target_key, (COALESCE(message_id, '')))
    WHERE status = 'open'`);
  await pool.query(`COMMENT ON TABLE reports IS 'staging:private'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS privacy_settings (
      user_id    TEXT PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query(`COMMENT ON TABLE privacy_settings IS 'staging:private'`);
  if (IS_STAGING) {
    // A few open reports from fake identities, so project members see the
    // Reports to review queue. Blocks and privacy settings are never
    // seeded: no rows is the real first-run answer.
    const demoReports = [
      [900001, 'staging-demo-user-1', 'Staging demo user 1', 'profile', 'mock:3', 'Priya', null, null,
        'spam', 'Staging demo report: same text sent to everyone'],
      [900002, 'staging-demo-user-2', 'Staging demo user 2', 'message', 'mock:1', 'Maya', 'm-1',
        'The glaze accident was on purpose, I swear.', 'harassment', 'Staging demo report'],
      [900003, 'staging-demo-user-2', 'Staging demo user 2', 'profile', 'mock:6', 'Felix', null, null,
        'fake', 'Staging demo report: photos look copied'],
    ];
    for (const r of demoReports) {
      await pool.query(
        `INSERT INTO reports (id, reporter_id, reporter_username, target_type, target_key, target_name,
           message_id, message_text, reason, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING`, r);
    }
  }
  dbReady = true;
}

// Reviewers are this project's members — the platform owns that list
// ("Members" in the platform conventions), so the app never builds its own.
// Cached briefly; a 403 or any fetch failure means "not a reviewer", never
// an error page.
const REVIEWER_CACHE_MS = 60 * 1000;
const reviewerCache = new Map(); // forwarded token -> { ids: Set<string>, at: number }

function forwardedToken(req) {
  return req.query.token || req.headers['x-usernode-token'] || '';
}

async function reviewerIds(req) {
  const base = (process.env.USERNODE_PLATFORM_API_V1_URL || '').replace(/\/+$/, '');
  const token = forwardedToken(req);
  if (!base || !token) return new Set();
  const hit = reviewerCache.get(token);
  if (hit && Date.now() - hit.at < REVIEWER_CACHE_MS) return hit.ids;
  let ids = new Set();
  try {
    const headers = { 'x-usernode-user-token': token };
    if (process.env.USERNODE_LLM_PROXY_TOKEN) {
      headers['x-usernode-app-token'] = process.env.USERNODE_LLM_PROXY_TOKEN;
    }
    const resp = await fetch(base + '/members', { headers });
    if (resp.ok) {
      const { members } = await resp.json();
      ids = new Set((members || []).map((m) => String(m.id)));
    }
  } catch (err) {
    console.warn('members fetch failed: ' + err.message);
  }
  reviewerCache.set(token, { ids, at: Date.now() });
  return ids;
}

// Server-side takedown path for submitted photos: files are deleted once a
// decision is made (or when a submission replaces an older one). Absent in
// staging — degrade silently.
async function deleteStoredPhoto(fileId, userToken) {
  const base = process.env.USERNODE_STORAGE_URL;
  const appToken = process.env.USERNODE_STORAGE_TOKEN;
  if (!fileId || !base || !appToken) return;
  try {
    await fetch(base.replace(/\/+$/, '') + '/files/' + encodeURIComponent(fileId), {
      method: 'DELETE',
      headers: { 'x-usernode-app-token': appToken, 'x-usernode-user-token': userToken },
    });
  } catch (err) {
    console.warn('photo deletion failed: ' + err.message);
  }
}

function verificationView(row, canReview) {
  const tier = row && row.photo_status === 'approved' ? 'photo'
    : row && row.email_verified_at ? 'email' : 'unverified';
  return {
    tier,
    email: {
      address: (row && row.email) || null,
      verified: !!(row && row.email_verified_at),
    },
    photo: {
      status: (row && row.photo_status) || 'none',
      note: (row && row.photo_note) || null,
      submittedAt: (row && row.photo_submitted_at) || null,
    },
    canReview,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.get('/api/verification', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Verification is not available here' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM user_verification WHERE user_id = $1', [req.user.id]);
    res.json(verificationView(rows[0], (await reviewerIds(req)).has(String(req.user.id))));
  } catch (err) {
    console.error('verification status failed', err.message);
    res.status(500).json({ error: 'Could not load verification status' });
  }
});

app.post('/api/verification/email/start', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Verification is not available here' });
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT * FROM user_verification WHERE user_id = $1', [req.user.id]);
    const row = rows[0];
    if (row && row.email_verified_at && row.email === email) {
      return res.status(400).json({ error: 'That email is already verified' });
    }
    // One pending code per user; a resend inside the cooldown is rejected.
    if (row && row.email_code_hash && row.email_code_expires_at) {
      const sentAt = new Date(row.email_code_expires_at).getTime() - CODE_TTL_MS;
      if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
        return res.status(429).json({ error: 'Please wait a minute before requesting another code' });
      }
    }

    // Changing the address resets the tier until the new one confirms.
    const code = sixDigitCode();
    await pool.query(
      `INSERT INTO user_verification
         (user_id, username, email, email_code_hash, email_code_expires_at, email_code_attempts, email_verified_at)
       VALUES ($1, $2, $3, $4, now() + interval '15 minutes', 0, NULL)
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         email = EXCLUDED.email,
         email_code_hash = EXCLUDED.email_code_hash,
         email_code_expires_at = EXCLUDED.email_code_expires_at,
         email_code_attempts = 0,
         email_verified_at = NULL,
         updated_at = now()`,
      [req.user.id, req.user.username, email, sha256(code)]);

    if (!SMTP_URL) {
      if (IS_STAGING) {
        // No email provider in staging previews: hand the code back so the
        // whole flow stays testable. The UI labels it as a staging demo.
        return res.json({ sent: true, demo: true, code });
      }
      return res.status(503).json({ error: 'Email delivery is not configured yet' });
    }
    try {
      const transport = nodemailer.createTransport(SMTP_URL);
      await transport.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: 'Your Omichat verification code',
        text: 'Your Omichat verification code is ' + code + '. It expires in 15 minutes.',
      });
    } catch (err) {
      console.error('verification email failed', err.message);
      return res.status(502).json({ error: 'Could not send the email. Try again shortly.' });
    }
    res.json({ sent: true });
  } catch (err) {
    console.error('email verification start failed', err.message);
    res.status(500).json({ error: 'Could not start email verification' });
  }
});

app.post('/api/verification/email/confirm', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Verification is not available here' });
  const code = String((req.body && req.body.code) || '').replace(/\D/g, '');
  if (code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit code' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM user_verification WHERE user_id = $1', [req.user.id]);
    const row = rows[0];
    if (!row || !row.email_code_hash) {
      return res.status(400).json({ error: 'No code is pending. Request a new one.' });
    }
    if (new Date(row.email_code_expires_at).getTime() < Date.now()) {
      await pool.query(
        'UPDATE user_verification SET email_code_hash = NULL, email_code_expires_at = NULL, updated_at = now() WHERE user_id = $1',
        [req.user.id]);
      return res.status(400).json({ error: 'That code has expired. Request a new one.' });
    }
    if (sha256(code) !== row.email_code_hash) {
      const attempts = row.email_code_attempts + 1;
      if (attempts >= CODE_MAX_ATTEMPTS) {
        // Too many wrong tries: invalidate so a fresh code must be sent.
        await pool.query(
          'UPDATE user_verification SET email_code_hash = NULL, email_code_expires_at = NULL, email_code_attempts = $2, updated_at = now() WHERE user_id = $1',
          [req.user.id, attempts]);
        return res.status(400).json({ error: 'Too many wrong attempts. Request a new code.' });
      }
      await pool.query(
        'UPDATE user_verification SET email_code_attempts = $2, updated_at = now() WHERE user_id = $1',
        [req.user.id, attempts]);
      return res.status(400).json({
        error: 'That code is not right. ' + (CODE_MAX_ATTEMPTS - attempts) + ' attempts left.',
      });
    }
    await pool.query(
      `UPDATE user_verification
       SET email_verified_at = now(), email_code_hash = NULL, email_code_expires_at = NULL,
           email_code_attempts = 0, updated_at = now()
       WHERE user_id = $1`,
      [req.user.id]);
    res.json({ verified: true });
  } catch (err) {
    console.error('email confirm failed', err.message);
    res.status(500).json({ error: 'Could not confirm the code' });
  }
});

app.post('/api/verification/photo', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Verification is not available here' });
  const fileId = String((req.body && req.body.fileId) || '');
  const url = String((req.body && req.body.url) || '');
  if (!/^[0-9a-f]{8,64}$/.test(fileId) || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: 'Upload the photo before submitting' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT photo_file_id FROM user_verification WHERE user_id = $1', [req.user.id]);
    if (rows[0] && rows[0].photo_file_id && rows[0].photo_file_id !== fileId) {
      // Replacing a pending or declined submission: drop the old file.
      await deleteStoredPhoto(rows[0].photo_file_id, forwardedToken(req));
    }
    await pool.query(
      `INSERT INTO user_verification
         (user_id, username, photo_file_id, photo_url, photo_status, photo_submitted_at)
       VALUES ($1, $2, $3, $4, 'pending', now())
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username,
         photo_file_id = EXCLUDED.photo_file_id,
         photo_url = EXCLUDED.photo_url,
         photo_status = 'pending',
         photo_submitted_at = now(),
         photo_reviewed_at = NULL,
         photo_note = NULL,
         updated_at = now()`,
      [req.user.id, req.user.username, fileId, url]);
    res.json({ status: 'pending' });
  } catch (err) {
    console.error('photo submission failed', err.message);
    res.status(500).json({ error: 'Could not submit the photo' });
  }
});

app.get('/api/verification/pending', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Verification is not available here' });
  if (!(await reviewerIds(req)).has(String(req.user.id))) {
    return res.status(403).json({ error: 'Not a reviewer' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT user_id, username, photo_url, photo_submitted_at
       FROM user_verification WHERE photo_status = 'pending'
       ORDER BY photo_submitted_at ASC LIMIT 50`);
    res.json({ pending: rows });
  } catch (err) {
    console.error('review queue failed', err.message);
    res.status(500).json({ error: 'Could not load the review queue' });
  }
});

app.post('/api/verification/review', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Verification is not available here' });
  if (!(await reviewerIds(req)).has(String(req.user.id))) {
    return res.status(403).json({ error: 'Not a reviewer' });
  }
  const userId = String((req.body && req.body.userId) || '');
  const decision = String((req.body && req.body.decision) || '');
  const note = String((req.body && req.body.note) || '').trim().slice(0, 300);
  if (!userId || (decision !== 'approve' && decision !== 'reject')) {
    return res.status(400).json({ error: 'Expected a user and a decision' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT photo_file_id FROM user_verification
       WHERE user_id = $1 AND photo_status = 'pending'`, [userId]);
    if (!rows.length) {
      return res.status(404).json({ error: 'That submission is no longer pending' });
    }
    // The file is deleted for either decision; only the outcome is kept.
    await deleteStoredPhoto(rows[0].photo_file_id, forwardedToken(req));
    await pool.query(
      `UPDATE user_verification
       SET photo_status = $2, photo_reviewed_at = now(), photo_note = $3,
           photo_file_id = NULL, photo_url = NULL, updated_at = now()
       WHERE user_id = $1 AND photo_status = 'pending'`,
      [userId, decision === 'approve' ? 'approved' : 'rejected', note || null]);
    res.json({ ok: true });
  } catch (err) {
    console.error('review decision failed', err.message);
    res.status(500).json({ error: 'Could not record the decision' });
  }
});

// ---------------------------------------------------------------- profiles
// The signed-in person's own profile. Photos are stored platform-side
// (usernode.uploadFile in the page); this table keeps only their ids and URLs.

app.get('/api/profile', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Profiles are not available here' });
  try {
    const { rows } = await pool.query(
      'SELECT data, updated_at FROM profiles WHERE user_id = $1', [req.user.id]);
    res.json({
      username: req.user.username,
      profile: rows[0] ? Object.assign(ProfileSchema.empty(), rows[0].data) : null,
      updatedAt: rows[0] ? rows[0].updated_at : null,
    });
  } catch (err) {
    console.error('profile load failed', err.message);
    res.status(500).json({ error: 'Could not load your profile' });
  }
});

app.put('/api/profile', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Profiles are not available here' });
  const { value, errors } = ProfileSchema.validate(req.body && req.body.profile, { fallbackName: req.user.username });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Check the highlighted fields', fields: errors });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO profiles (user_id, username, data, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET
         username = EXCLUDED.username, data = EXCLUDED.data, updated_at = now()
       RETURNING data, updated_at`,
      [req.user.id, req.user.username || '', JSON.stringify(value)]);
    res.json({ username: req.user.username, profile: rows[0].data, updatedAt: rows[0].updated_at });
  } catch (err) {
    console.error('profile save failed', err.message);
    res.status(500).json({ error: 'Could not save your profile' });
  }
});

// ------------------------------------------------------------------ safety
// Blocks, reports and privacy settings for the signed-in account. Blocks are
// permanent: there is deliberately no route that removes one.

const REPORTS_PER_DAY = 20;
const IMPORT_BLOCKS_MAX = 200;

async function loadSafety(userId) {
  const [settings, blocked] = await Promise.all([
    pool.query('SELECT data FROM privacy_settings WHERE user_id = $1', [userId]),
    pool.query(
      `SELECT blocked_key AS key, blocked_name AS name, created_at AS at
       FROM blocks WHERE blocker_id = $1 ORDER BY created_at ASC`, [userId]),
  ]);
  return {
    privacy: Safety.normalizePrivacy(settings.rows[0] && settings.rows[0].data),
    blocked: blocked.rows,
  };
}

// Whether either of two accounts blocked the other, and how they are
// related, seen from `aId`'s seat (the shape Safety.canMessage and
// Safety.canSeeProfile take). Hellos and connections are not stored yet,
// so only the block is known. Nothing calls these today, because no route
// lists other real people or sends messages: they are the required gate
// for the real Discover and chat endpoints when those arrive.
async function isBlockedEither(aId, bId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM blocks
     WHERE (blocker_id = $1 AND blocked_key = $2) OR (blocker_id = $3 AND blocked_key = $4)
     LIMIT 1`,
    [String(aId), 'user:' + bId, String(bId), 'user:' + aId]);
  return rows.length > 0;
}

async function relationBetween(aId, bId) {
  return { blocked: await isBlockedEither(aId, bId), saidHi: false, connected: false };
}

app.get('/api/safety', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Safety settings are not available here' });
  try {
    const safety = await loadSafety(req.user.id);
    safety.canReview = (await reviewerIds(req)).has(String(req.user.id));
    res.json(safety);
  } catch (err) {
    console.error('safety load failed', err.message);
    res.status(500).json({ error: 'Could not load your safety settings' });
  }
});

app.put('/api/privacy', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Safety settings are not available here' });
  try {
    const current = await pool.query('SELECT data FROM privacy_settings WHERE user_id = $1', [req.user.id]);
    const { value, errors } = Safety.validatePrivacy(req.body && req.body.privacy,
      Safety.normalizePrivacy(current.rows[0] && current.rows[0].data));
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Could not save that setting. Try again.', fields: errors });
    }
    const { rows } = await pool.query(
      `INSERT INTO privacy_settings (user_id, data, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
       RETURNING data`,
      [req.user.id, JSON.stringify(value)]);
    res.json({ privacy: Safety.normalizePrivacy(rows[0].data) });
  } catch (err) {
    console.error('privacy save failed', err.message);
    res.status(500).json({ error: 'Could not save that setting. Try again.' });
  }
});

app.post('/api/blocks', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Blocking is not available here' });
  const key = String((req.body && req.body.key) || '');
  const name = String((req.body && req.body.name) || '').trim().slice(0, 100) || null;
  if (!Safety.isTargetKey(key)) return res.status(400).json({ error: 'Choose someone to block.' });
  if (key === 'user:' + req.user.id) return res.status(400).json({ error: 'You cannot block yourself.' });
  try {
    await pool.query(
      `INSERT INTO blocks (blocker_id, blocked_key, blocked_name) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`, [req.user.id, key, name]);
    res.json({ blocked: (await loadSafety(req.user.id)).blocked });
  } catch (err) {
    console.error('block failed', err.message);
    res.status(500).json({ error: 'Could not block this person. Try again.' });
  }
});

// One-time copy of what an older version kept on the device. Blocks are
// always merged (they are permanent, so keeping one is never wrong); the
// device's privacy switches are taken only when the account has none yet.
app.post('/api/safety/import', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Safety settings are not available here' });
  const body = req.body || {};
  const blocked = (Array.isArray(body.blocked) ? body.blocked : [])
    .slice(0, IMPORT_BLOCKS_MAX)
    .filter((b) => b && Safety.isTargetKey(b.key) && b.key !== 'user:' + req.user.id);
  try {
    for (const b of blocked) {
      await pool.query(
        `INSERT INTO blocks (blocker_id, blocked_key, blocked_name) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [req.user.id, b.key, String(b.name || '').trim().slice(0, 100) || null]);
    }
    if (body.privacy && typeof body.privacy === 'object') {
      await pool.query(
        `INSERT INTO privacy_settings (user_id, data) VALUES ($1, $2::jsonb)
         ON CONFLICT (user_id) DO NOTHING`,
        [req.user.id, JSON.stringify(Safety.normalizePrivacy(body.privacy))]);
    }
    const safety = await loadSafety(req.user.id);
    safety.canReview = (await reviewerIds(req)).has(String(req.user.id));
    res.json(safety);
  } catch (err) {
    console.error('safety import failed', err.message);
    res.status(500).json({ error: 'Could not copy your settings.' });
  }
});

app.post('/api/reports', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Reports are not available here' });
  const { value, error } = Safety.validateReport(req.body);
  if (error) return res.status(400).json({ error });
  if (value.targetKey === 'user:' + req.user.id) {
    return res.status(400).json({ error: 'You cannot report yourself.' });
  }
  const findOpen = () => pool.query(
    `SELECT id FROM reports
     WHERE reporter_id = $1 AND target_key = $2 AND COALESCE(message_id, '') = COALESCE($3, '')
       AND status = 'open'`,
    [req.user.id, value.targetKey, value.messageId]);
  try {
    // Reporting the same thing again while it waits is not a new report.
    const open = await findOpen();
    if (open.rows.length) return res.json({ id: open.rows[0].id });
    const recent = await pool.query(
      `SELECT count(*)::int AS n FROM reports
       WHERE reporter_id = $1 AND created_at > now() - interval '24 hours'`, [req.user.id]);
    if (recent.rows[0].n >= REPORTS_PER_DAY) {
      return res.status(429).json({ error: 'You have sent a lot of reports today. Try again tomorrow.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO reports (reporter_id, reporter_username, target_type, target_key, target_name,
         message_id, message_text, reason, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [req.user.id, req.user.username || '', value.targetType, value.targetKey,
        value.targetName || null, value.messageId, value.messageText, value.reason, value.note]);
    if (rows.length) return res.json({ id: rows[0].id });
    // Lost a race with an identical report: answer with that one.
    const again = await findOpen();
    res.json({ id: again.rows[0] ? again.rows[0].id : null });
  } catch (err) {
    console.error('report failed', err.message);
    res.status(500).json({ error: 'Could not send the report. Try again.' });
  }
});

app.get('/api/reports/pending', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Reports are not available here' });
  if (!(await reviewerIds(req)).has(String(req.user.id))) {
    return res.status(403).json({ error: 'Not a reviewer' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, reporter_username, target_type, target_key, target_name, message_id,
         message_text, reason, note, created_at
       FROM reports WHERE status = 'open'
       ORDER BY created_at ASC, id ASC LIMIT 50`);
    res.json({ reports: rows });
  } catch (err) {
    console.error('report queue failed', err.message);
    res.status(500).json({ error: 'Could not load the reports' });
  }
});

app.post('/api/reports/:id/review', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Reports are not available here' });
  if (!(await reviewerIds(req)).has(String(req.user.id))) {
    return res.status(403).json({ error: 'Not a reviewer' });
  }
  const id = Number(req.params.id);
  const decision = String((req.body && req.body.decision) || '');
  if (!Number.isInteger(id) || (decision !== 'reviewed' && decision !== 'dismissed')) {
    return res.status(400).json({ error: 'Expected a report and a decision' });
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE reports SET status = $2, reviewed_at = now(), reviewed_by = $3
       WHERE id = $1 AND status = 'open'`,
      [id, decision, req.user.username || String(req.user.id)]);
    if (!rowCount) return res.status(404).json({ error: 'That report is no longer open' });
    res.json({ ok: true });
  } catch (err) {
    console.error('report review failed', err.message);
    res.status(500).json({ error: 'Could not save the decision. Try again.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/omichat-6825e7/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/omichat-6825e7/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    // The app still serves; verification routes answer 503 until the DB is back.
    console.error('[boot] schema setup failed', err.message);
  }
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  // Every deploy stops this container with SIGTERM and a bounded grace
  // period. Drain in-flight requests, close the pool, exit — and make a
  // repeat signal a no-op, not a second teardown.
  const DRAIN_MS = 3000;
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining`);
    server.close(() => {});
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
    try {
      await pool.end();
    } catch (err) {
      console.error('[shutdown] pool.end failed', err.message);
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => { console.error(err); process.exit(1); });
