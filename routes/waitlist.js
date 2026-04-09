const { neon } = require("@neondatabase/serverless");

const SUCCESS_MESSAGE = "You're on the list. We'll be in touch soon.";
const DUPLICATE_MESSAGE = "You're already on the list. We'll be in touch soon.";
const SERVER_MESSAGE = "Something went wrong. Please try again.";
const NOT_CONFIGURED_MESSAGE =
  "Waitlist storage is not configured. Add DATABASE_URL in the project environment.";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isNonEmptyString(v, max) {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length > 0 && t.length <= max;
}

function isBasicEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

const LINKEDIN_PREFIXES = ["https://linkedin.com/in/", "https://www.linkedin.com/in/"];

function isValidLinkedInUrl(url) {
  const s = String(url).trim();
  if (s.length === 0 || s.length > 200) return false;
  return LINKEDIN_PREFIXES.some((p) => s.startsWith(p));
}

let _sql;
function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!_sql) _sql = neon(url);
  return _sql;
}

let _schemaReady;
async function ensureSchema(sql) {
  if (_schemaReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      linkedin_url TEXT,
      tier TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;
  _schemaReady = true;
}

async function sendWaitlistNotificationEmail({ name, email, linkedin_url, tier }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;

  const to = process.env.WAITLIST_EMAIL_TO || "contact@sendhook.com";
  const from = process.env.RESEND_FROM || "Scouthook <noreply@send.scouthook.com>";

  const safeName = String(name || "").trim();
  const safeEmail = String(email || "").trim();
  const safeTier = String(tier || "").trim();
  const safeLinkedIn = linkedin_url ? String(linkedin_url).trim() : "";

  const html = `
<p><strong>Name</strong><br>${escapeHtml(safeName)}</p>
<p><strong>Email</strong><br>${escapeHtml(safeEmail)}</p>
<p><strong>Tier</strong><br>${escapeHtml(safeTier)}</p>
<p><strong>LinkedIn</strong><br>${safeLinkedIn ? `<a href="${escapeHtml(safeLinkedIn)}">${escapeHtml(safeLinkedIn)}</a>` : "(not provided)"}</p>
`.trim();

  const text = [
    `Name: ${safeName}`,
    `Email: ${safeEmail}`,
    `Tier: ${safeTier}`,
    `LinkedIn: ${safeLinkedIn || "(not provided)"}`,
  ].join("\n");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: safeEmail,
        subject: `New waitlist signup — Scouthook (${safeTier})`,
        html,
        text,
      }),
    });

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("Resend error (waitlist)", r.status, errText);
    }
  } catch (e) {
    console.error("Resend error (waitlist)", e);
  }
}

function getAdminTokenFromReq(req) {
  const h = req.headers || {};
  const auth = typeof h.authorization === "string" ? h.authorization : "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const x = typeof h["x-admin-token"] === "string" ? h["x-admin-token"] : "";
  if (x) return x.trim();

  try {
    const u = new URL(req.url, "http://localhost");
    const t = u.searchParams.get("token");
    return t ? t.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Returns waitlist rows (admin only).
 * @returns {Promise<{ status: number, json: object }>}
 */
async function getWaitlist(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return {
      status: 503,
      json: {
        error: "server",
        message: "Admin access is not configured. Add ADMIN_TOKEN in the environment.",
      },
    };
  }

  const token = getAdminTokenFromReq(req);
  if (!token || token !== expected) {
    return { status: 401, json: { error: "unauthorized", message: "Unauthorized" } };
  }

  const sql = getSql();
  if (!sql) {
    return {
      status: 503,
      json: { error: "server", message: NOT_CONFIGURED_MESSAGE },
    };
  }

  try {
    await ensureSchema(sql);
    const rows = await sql`
      SELECT id, name, email, linkedin_url, tier, created_at
      FROM waitlist
      ORDER BY created_at DESC
      LIMIT 500
    `;
    return { status: 200, json: { ok: true, rows } };
  } catch (e) {
    console.error("waitlist list error", e);
    return { status: 500, json: { error: "server", message: SERVER_MESSAGE } };
  }
}

/**
 * Validates input and inserts into waitlist (Neon Postgres).
 * @returns {Promise<{ status: number, json: object }>}
 */
async function postWaitlist(body) {
  const name = body.name;
  const email = body.email;
  const tier = body.tier;
  let linkedin_url =
    typeof body.linkedin_url === "string" ? body.linkedin_url.trim() : "";

  if (!isNonEmptyString(name, 100)) {
    return {
      status: 400,
      json: {
        error: "validation",
        message: "Please enter your name (max 100 characters).",
      },
    };
  }

  if (typeof email !== "string" || !email.trim()) {
    return {
      status: 400,
      json: { error: "validation", message: "Please enter a valid email address." },
    };
  }
  const emailTrim = email.trim();
  if (emailTrim.length > 200 || !isBasicEmail(emailTrim)) {
    return {
      status: 400,
      json: { error: "validation", message: "Please enter a valid email address." },
    };
  }

  if (tier !== "free" && tier !== "pro") {
    return {
      status: 400,
      json: {
        error: "validation",
        message: 'Please choose either the "free" or "pro" plan.',
      },
    };
  }

  if (linkedin_url) {
    if (!isValidLinkedInUrl(linkedin_url)) {
      return {
        status: 400,
        json: {
          error: "validation",
          message:
            "LinkedIn URL must start with https://linkedin.com/in/ or https://www.linkedin.com/in/ (max 200 characters).",
        },
      };
    }
  } else {
    linkedin_url = null;
  }

  const nameTrim = name.trim();

  const sql = getSql();
  if (!sql) {
    return {
      status: 503,
      json: { error: "server", message: NOT_CONFIGURED_MESSAGE },
    };
  }

  try {
    await ensureSchema(sql);
    await sql`
      INSERT INTO waitlist (name, email, linkedin_url, tier)
      VALUES (${nameTrim}, ${emailTrim}, ${linkedin_url}, ${tier})
    `;
    sendWaitlistNotificationEmail({
      name: nameTrim,
      email: emailTrim,
      linkedin_url,
      tier,
    });
    return {
      status: 201,
      json: { success: true, message: SUCCESS_MESSAGE },
    };
  } catch (e) {
    const code = e && e.code;
    if (code === "23505") {
      return {
        status: 409,
        json: { error: "duplicate", message: DUPLICATE_MESSAGE },
      };
    }
    console.error("waitlist insert error", e);
    return {
      status: 500,
      json: { error: "server", message: SERVER_MESSAGE },
    };
  }
}

module.exports = { postWaitlist, getWaitlist };
