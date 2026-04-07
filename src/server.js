import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCompressedBackup,
  detectChromeBookmarkFiles,
  getBackupStorePath,
  listBackups,
  readBookmarksFile,
  resolveInputPath,
  restoreBackup,
  writeBookmarksFile,
} from "./backup-service.js";
import {
  analyzeBookmarks,
  createChromeBookmarkPayload,
  createExportPayload,
  getDefaultChromePaths,
} from "./bookmark-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const port = Number(process.env.PORT || 3210);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function serveStatic(response, requestPath) {
  const targetPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(publicDir, targetPath));

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "허용되지 않은 경로입니다." });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "파일을 찾을 수 없습니다." });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        port,
        defaultChromePaths: getDefaultChromePaths(),
        detectedChromePaths: await detectChromeBookmarkFiles(),
        backupStorePath: getBackupStorePath(),
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/backups") {
      const targetPath = requestUrl.searchParams.get("path");
      if (!targetPath) {
        sendJson(response, 400, { error: "path가 필요합니다." });
        return;
      }

      sendJson(response, 200, {
        resolvedPath: resolveInputPath(targetPath),
        backups: await listBackups(targetPath),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/analyze") {
      const body = await readBody(request);
      const rawText = body.rawText;
      if (!rawText) {
        sendJson(response, 400, { error: "rawText가 필요합니다." });
        return;
      }

      const analysis = await analyzeBookmarks(rawText, body.options ?? {});
      sendJson(response, 200, { analysis });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/analyze-path") {
      const body = await readBody(request);
      if (!body.path) {
        sendJson(response, 400, { error: "path가 필요합니다." });
        return;
      }

      const { rawText, resolvedPath } = await readBookmarksFile(body.path);
      const analysis = await analyzeBookmarks(rawText, body.options ?? {});
      sendJson(response, 200, {
        rawText,
        resolvedPath,
        analysis,
        backups: await listBackups(resolvedPath),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/backup") {
      const body = await readBody(request);
      if (!body.path) {
        sendJson(response, 400, { error: "path가 필요합니다." });
        return;
      }

      const { resolvedPath, rawText } = await readBookmarksFile(body.path);
      const backup = await createCompressedBackup(resolvedPath, {
        reason: body.reason ?? "manual",
        rawText,
      });

      sendJson(response, 200, {
        resolvedPath,
        backup,
        backups: await listBackups(resolvedPath),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/apply") {
      const body = await readBody(request);
      if (!body.path || !body.rawText || !body.analysis) {
        sendJson(response, 400, { error: "path, rawText, analysis가 필요합니다." });
        return;
      }

      const { resolvedPath } = await readBookmarksFile(body.path);
      const backup = await createCompressedBackup(resolvedPath, {
        reason: "pre-apply",
      });

      const nextPayload = createChromeBookmarkPayload(body.rawText, body.analysis, body.options ?? {});
      await writeBookmarksFile(resolvedPath, nextPayload.content);

      const analysis = await analyzeBookmarks(nextPayload.content, body.analysisOptions ?? {});
      sendJson(response, 200, {
        resolvedPath,
        rawText: nextPayload.content,
        analysis,
        backup,
        backups: await listBackups(resolvedPath),
        exportedSize: nextPayload.exportedSize,
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/rollback") {
      const body = await readBody(request);
      if (!body.path || !body.backupId) {
        sendJson(response, 400, { error: "path와 backupId가 필요합니다." });
        return;
      }

      const restored = await restoreBackup(body.path, body.backupId);
      const analysis = await analyzeBookmarks(restored.rawText, body.analysisOptions ?? {});
      sendJson(response, 200, {
        resolvedPath: restored.resolvedPath,
        rawText: restored.rawText,
        analysis,
        restoredBackup: restored.backup,
        safetyBackup: restored.safetyBackup,
        backups: await listBackups(restored.resolvedPath),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/export") {
      const body = await readBody(request);
      if (!body.rawText || !body.analysis) {
        sendJson(response, 400, { error: "rawText와 analysis가 필요합니다." });
        return;
      }

      const payload = createExportPayload(body.rawText, body.analysis, body.options ?? {});
      response.writeHead(200, {
        "Content-Type": payload.contentType,
        "Content-Disposition": `attachment; filename="bookmarks-organized.${payload.extension}"`,
      });
      response.end(payload.content);
      return;
    }

    await serveStatic(response, requestUrl.pathname);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
    });
  }
});

server.listen(port, () => {
  console.log(`Chrome Bookmark Organizer running at http://localhost:${port}`);
});
