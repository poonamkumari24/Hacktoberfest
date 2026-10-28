const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  });
  res.end(JSON.stringify(value));
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function proxyOllama(req, res, endpoint, body) {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:11434${endpoint}`, {
      method: req.method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    sendJson(res, 502, {
      error: "Could not reach Ollama at 127.0.0.1:11434. Start Ollama and try again.",
      detail: error.message,
    });
    return;
  }

  const contentType = response.headers.get("content-type") || "application/json";
  res.writeHead(response.status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(await response.text());
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/api/tags") {
      await proxyOllama(req, res, "/api/tags");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch (error) {
        sendJson(res, 400, { error: `Invalid request: ${error.message}` });
        return;
      }
      if (
        !payload ||
        typeof payload.model !== "string" ||
        !payload.model.trim() ||
        !Array.isArray(payload.messages) ||
        payload.messages.length === 0 ||
        payload.messages.some(
          (message) =>
            !message ||
            !["system", "user", "assistant"].includes(message.role) ||
            typeof message.content !== "string",
        )
      ) {
        sendJson(res, 400, { error: "A model and valid chat messages are required." });
        return;
      }
      await proxyOllama(
        req,
        res,
        "/api/chat",
        JSON.stringify({ ...payload, stream: false }),
      );
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendJson(res, 400, { error: "Invalid URL path." });
      return;
    }
    if (pathname === "/") pathname = "/index.html";
    if (!["/index.html", "/styles.css", "/app.js"].includes(pathname)) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    const filePath = path.resolve(root, `.${pathname}`);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    let content;
    try {
      content = await fs.readFile(filePath);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") {
        sendJson(res, 404, { error: "Not found." });
        return;
      }
      throw error;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: "The local server encountered an error." });
    else res.destroy(error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Keepsake is ready at http://127.0.0.1:${port}`);
});
