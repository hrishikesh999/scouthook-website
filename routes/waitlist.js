const { getDb } = require("../lib/sqlite");

const SUCCESS_MESSAGE = "You're on the list. We'll be in touch soon.";
const DUPLICATE_MESSAGE = "You're already on the list. We'll be in touch soon.";
const SERVER_MESSAGE = "Something went wrong. Please try again.";

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

/**
 * Validates input and inserts into waitlist.
 * @returns {{ status: number, json: object }}
 */
function postWaitlist(body) {
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

  try {
    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO waitlist (name, email, linkedin_url, tier) VALUES (@name, @email, @linkedin_url, @tier)`
    );
    stmt.run({
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
    const msg = e && e.message ? String(e.message) : "";
    if (code === "SQLITE_CONSTRAINT_UNIQUE" || msg.includes("UNIQUE")) {
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
