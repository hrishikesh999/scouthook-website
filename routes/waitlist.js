const { neon } = require("@neondatabase/serverless");

const SUCCESS_MESSAGE = "You're on the list. We'll be in touch soon.";
const DUPLICATE_MESSAGE = "You're already on the list. We'll be in touch soon.";
const SERVER_MESSAGE = "Something went wrong. Please try again.";
const NOT_CONFIGURED_MESSAGE =
  "Waitlist storage is not configured. Add DATABASE_URL in the project environment.";

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

module.exports = { postWaitlist };
