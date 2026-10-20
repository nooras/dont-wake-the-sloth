const { createReadStream, existsSync, statSync } = require("node:fs");
const { createServer } = require("node:http");
const { extname, join, resolve, sep } = require("node:path");

const root = resolve("dist");
const indexPath = join(root, "index.html");
const port = Number(process.env.PORT || 10000);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

if (!existsSync(indexPath)) {
  throw new Error("Production build not found. Run `npm run build` before starting the server.");
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Bad Request");
    return;
  }

  const filePath = resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  const isFile = existsSync(filePath) && statSync(filePath).isFile();
  const hasExtension = extname(pathname) !== "";
  const resolvedPath = isFile ? filePath : hasExtension ? null : indexPath;

  if (!resolvedPath || !existsSync(resolvedPath)) {
    response.writeHead(404).end("Not Found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    "Content-Type": mimeTypes[extname(resolvedPath)] || "application/octet-stream",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(resolvedPath)
    .on("error", (error) => {
      console.error("Failed to serve request:", error);
      if (!response.headersSent) response.writeHead(500);
      response.end("Internal Server Error");
    })
    .pipe(response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Serving ${root} on 0.0.0.0:${port}`);
});
