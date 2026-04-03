function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function getJsonBody(req) {
  if (req.body != null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  return readBody(req);
}

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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function parseResendError(status, errText) {
  try {
    const j = JSON.parse(errText);
    if (j && j.message) return j.message;
  } catch {
    /* ignore */
  }
  return `Resend returned ${status}`;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: "Email is not configured on the server." }));
  }

  let body;
  try {
    body = await getJsonBody(req);
  } catch {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Invalid request body." }));
  }

  const name = body.name;
  const email = body.email;
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!isNonEmptyString(name, 200)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Name is required." }));
  }
  if (!isValidEmail(email)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "A valid email address is required." }));
  }
  if (!message || message.length > 5000) {
    res.statusCode = 400;
    return res.end(
      JSON.stringify({
        error: "Message is required (max 5,000 characters).",
      })
    );
  }

  const to = process.env.CONTACT_EMAIL_TO || process.env.EMAIL_TO || "contact@scouthook.com";
  const from =
    process.env.RESEND_FROM || "Scouthook <noreply@send.scouthook.com>";

  const safeName = name.trim();
  const safeEmail = email.trim();

  const html = `
<p><strong>Name</strong><br>${escapeHtml(safeName)}</p>
<p><strong>Email</strong><br>${escapeHtml(safeEmail)}</p>
<p><strong>Message</strong></p>
<div style="white-space:pre-wrap;font-family:inherit">${escapeHtml(message)}</div>
`.trim();

  const text = [`Name: ${safeName}`, `Email: ${safeEmail}`, "", "Message:", message].join("\n");

  const payload = {
    from,
    to: [to],
    reply_to: safeEmail,
    subject: `Contact form — Scouthook (${safeName})`,
    html,
    text,
  };

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const errText = await r.text();

    if (!r.ok) {
      const detail = parseResendError(r.status, errText);
      console.error("Resend error (contact)", r.status, detail, errText);

      let userMessage = "Could not send your message. Please try again later.";

      if (detail.includes("only send") && detail.includes("email")) {
        userMessage =
          "Resend is in test mode: you can only send to your own verified address. In Vercel, set CONTACT_EMAIL_TO or EMAIL_TO to the same email you use in Resend, or verify send.scouthook.com in Resend.";
      } else if (
        detail.includes("domain") ||
        detail.includes("verify") ||
        detail.includes("not verified")
      ) {
        userMessage =
          "Email sender domain is not verified in Resend. Finish DNS for send.scouthook.com in Resend, or set RESEND_FROM to Resend’s test sender onboarding@resend.dev while testing.";
      } else if (r.status === 401 || r.status === 403) {
        userMessage =
          "Invalid or unauthorized Resend API key. Check RESEND_API_KEY in Vercel environment variables.";
      } else if (
        process.env.RESEND_DEBUG === "1" ||
        process.env.VERCEL_ENV === "preview" ||
        process.env.NODE_ENV === "development"
      ) {
        userMessage = detail;
      }

      res.statusCode = 502;
      return res.end(JSON.stringify({ error: userMessage }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error(e);
    res.statusCode = 502;
    return res.end(
      JSON.stringify({
        error: "Could not send your message. Please try again later.",
      })
    );
  }
};
