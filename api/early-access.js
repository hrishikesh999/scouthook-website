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

function isValidLinkedInProfileUrl(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "linkedin.com" && host !== "linkedin.cn") return false;
    return /\/(in|pub|company|school)\//i.test(u.pathname);
  } catch {
    return false;
  }
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
    body = await readBody(req);
  } catch {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Invalid request body." }));
  }

  const name = body.name;
  const email = body.email;
  let linkedinUrl = typeof body.linkedinUrl === "string" ? body.linkedinUrl.trim() : "";
  if (linkedinUrl && !/^https?:\/\//i.test(linkedinUrl)) {
    linkedinUrl = "https://" + linkedinUrl;
  }

  if (!isNonEmptyString(name, 200)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "Name is required." }));
  }
  if (!isValidEmail(email)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: "A valid email address is required." }));
  }
  if (!isNonEmptyString(linkedinUrl, 500) || !isValidLinkedInProfileUrl(linkedinUrl)) {
    res.statusCode = 400;
    return res.end(
      JSON.stringify({
        error: "A valid LinkedIn profile URL is required (e.g. https://www.linkedin.com/in/your-profile).",
      })
    );
  }

  const to = process.env.EMAIL_TO || "contact@scouthook.com";
  const from =
    process.env.RESEND_FROM || "Scouthook <onboarding@resend.dev>";

  const html = `
<p><strong>Name</strong><br>${escapeHtml(name)}</p>
<p><strong>Email</strong><br>${escapeHtml(email)}</p>
<p><strong>LinkedIn profile URL</strong><br><a href="${escapeHtml(linkedinUrl)}">${escapeHtml(linkedinUrl)}</a></p>
`.trim();

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
        reply_to: email.trim(),
        subject: "Early access request — Scouthook",
        html,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("Resend error", r.status, errText);
      res.statusCode = 502;
      return res.end(JSON.stringify({ error: "Could not send your request. Please try again later." }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error(e);
    res.statusCode = 502;
    return res.end(JSON.stringify({ error: "Could not send your request. Please try again later." }));
  }
};
