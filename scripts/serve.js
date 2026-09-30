// Tiny static web server for the front-end (no extra packages needed).
// Usage: node scripts/serve.js   ->  http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "frontend");
const port = process.env.PORT || 3000;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}).listen(port, () => console.log(`EvidenceChain UI running at http://localhost:${port}`));
