const { postWaitlist, getWaitlist } = require("../routes/waitlist");

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

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET") {
    const result = await getWaitlist(req);
    res.statusCode = result.status;
    return res.end(JSON.stringify(result.json));
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, POST");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  let body;
  try {
    body = await getJsonBody(req);
  } catch {
    res.statusCode = 400;
    return res.end(
      JSON.stringify({
        error: "validation",
        message: "Request body must be valid JSON.",
      })
    );
  }

  const result = await postWaitlist(body);
  res.statusCode = result.status;
  return res.end(JSON.stringify(result.json));
};
