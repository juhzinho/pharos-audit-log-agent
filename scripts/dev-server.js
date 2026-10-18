import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import audit from "../api/audit.js";

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const ROUTES = { "/api/audit": audit };

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (ROUTES[pathname]) return ROUTES[pathname](req, res);
    const file = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
    if (file.startsWith("..")) return res.writeHead(403).end();
    try {
      const body = await readFile(join(ROOT, file));
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}`));
