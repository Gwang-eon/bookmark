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
import {
  computeContentFingerprint,
  createSessionToken,
  hasValidSessionToken,
  validateApplyAnalysisContext,
} from "./server-guards.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
const localFileAccessMode = process.env.BOOKMARK_ACCESS_MODE !== "remote";
const host = process.env.HOST || (localFileAccessMode ? "127.0.0.1" : "0.0.0.0");
const port = Number(process.env.PORT || 3210);
const sessionToken = createSessionToken();

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

function requireSessionToken(request, response) {
  if (hasValidSessionToken(request.headers, sessionToken)) {
    return true;
  }

  sendJson(response, 403, {
    error: "로컬 세션 토큰이 없거나 일치하지 않습니다. 페이지를 새로고침한 뒤 다시 시도하세요.",
  });
  return false;
}

function requireLocalFileAccess(response) {
  if (localFileAccessMode) {
    return true;
  }

  sendJson(response, 403, {
    error: "현재 서버는 remote 모드로 실행 중입니다. 로컬 Bookmarks 경로 접근, 직접 적용, 백업/롤백은 사용할 수 없습니다.",
  });
  return false;
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
        host,
        mode: localFileAccessMode ? "local" : "remote",
        localFileAccessMode,
        defaultChromePaths: getDefaultChromePaths(),
        detectedChromePaths: localFileAccessMode ? await detectChromeBookmarkFiles() : [],
        backupStorePath: localFileAccessMode ? getBackupStorePath() : null,
        sessionToken: localFileAccessMode ? sessionToken : null,
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/backups") {
      if (!requireLocalFileAccess(response)) {
        return;
      }
      if (!requireSessionToken(request, response)) {
        return;
      }

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
      sendJson(response, 200, {
        analysis,
        analysisContext: {
          kind: "upload",
          sourceFingerprint: computeContentFingerprint(rawText),
        },
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/analyze-path") {
      if (!requireLocalFileAccess(response)) {
        return;
      }
      if (!requireSessionToken(request, response)) {
        return;
      }

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
        analysisContext: {
          kind: "path",
          resolvedPath,
          sourceFingerprint: computeContentFingerprint(rawText),
        },
        backups: await listBackups(resolvedPath),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/backup") {
      if (!requireLocalFileAccess(response)) {
        return;
      }
      if (!requireSessionToken(request, response)) {
        return;
      }

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
      if (!requireLocalFileAccess(response)) {
        return;
      }
      if (!requireSessionToken(request, response)) {
        return;
      }

      const body = await readBody(request);
      if (!body.path || !body.rawText || !body.analysis || !body.analysisContext) {
        sendJson(response, 400, { error: "path, rawText, analysis, analysisContext가 필요합니다." });
        return;
      }

      const { rawText: currentRawText, resolvedPath } = await readBookmarksFile(body.path);
      const validationError = validateApplyAnalysisContext({
        analysisContext: body.analysisContext,
        requestedPath: body.path,
        resolvedPath,
        currentFingerprint: computeContentFingerprint(currentRawText),
        sourceFingerprint: computeContentFingerprint(body.rawText),
      });
      if (validationError) {
        sendJson(response, 409, { error: validationError });
        return;
      }

      const backup = await createCompressedBackup(resolvedPath, {
        reason: "pre-apply",
        rawText: currentRawText,
      });

      const nextPayload = createChromeBookmarkPayload(body.rawText, body.analysis, body.options ?? {});
      await writeBookmarksFile(resolvedPath, nextPayload.content);

      const analysis = await analyzeBookmarks(nextPayload.content, body.analysisOptions ?? {});
      sendJson(response, 200, {
        resolvedPath,
        rawText: nextPayload.content,
        analysis,
        analysisContext: {
          kind: "path",
          resolvedPath,
          sourceFingerprint: computeContentFingerprint(nextPayload.content),
        },
        backup,
        backups: await listBackups(resolvedPath),
        exportedSize: nextPayload.exportedSize,
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/rollback") {
      if (!requireLocalFileAccess(response)) {
        return;
      }
      if (!requireSessionToken(request, response)) {
        return;
      }

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
        analysisContext: {
          kind: "path",
          resolvedPath: restored.resolvedPath,
          sourceFingerprint: computeContentFingerprint(restored.rawText),
        },
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

server.listen(port, host, () => {
  console.log(`Chrome Bookmark Organizer running at http://${host}:${port}`);
});
