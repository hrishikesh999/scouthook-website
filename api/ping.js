module.exports = (req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true }));
};
