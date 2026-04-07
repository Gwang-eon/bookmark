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

const CACHE_TTL_MS = 30 * 60 * 1000;
const analysisCache = new Map();

function cacheAnalysis(fingerprint, entry) {
  analysisCache.set(fingerprint, { ...entry, cachedAt: Date.now() });
}

function getCachedAnalysis(fingerprint) {
  const entry = analysisCache.get(fingerprint);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    analysisCache.delete(fingerprint);
    return null;
  }
  return entry;
}

function evictCache(fingerprint) {
  analysisCache.delete(fingerprint);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of analysisCache) {
    if (now - entry.cachedAt > CACHE_TTL_MS) {
      analysisCache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

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

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB

async function readBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error(`요청 본문이 너무 큽니다. 최대 ${MAX_BODY_BYTES / 1024 / 1024}MB까지 허용됩니다.`);
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("요청 본문이 올바른 JSON 형식이 아닙니다.");
  }
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

async function handleHealth(_request, _response, _url) {
  return {
    ok: true,
    port,
    host,
    mode: localFileAccessMode ? "local" : "remote",
    localFileAccessMode,
    defaultChromePaths: getDefaultChromePaths(),
    detectedChromePaths: localFileAccessMode ? await detectChromeBookmarkFiles() : [],
    backupStorePath: localFileAccessMode ? getBackupStorePath() : null,
  };
}

async function handleSession(_request, response) {
  if (!localFileAccessMode) {
    sendJson(response, 403, { error: "remote 모드에서는 세션 토큰을 발급하지 않습니다." });
    return null;
  }
  return { sessionToken };
}

async function handleBackups(request, response, requestUrl) {
  if (!requireLocalFileAccess(response) || !requireSessionToken(request, response)) {
    return null;
  }

  const targetPath = requestUrl.searchParams.get("path");
  if (!targetPath) {
    sendJson(response, 400, { error: "path가 필요합니다." });
    return null;
  }

  return {
    resolvedPath: resolveInputPath(targetPath),
    backups: await listBackups(targetPath),
  };
}

async function handleAnalyze(request, response) {
  const body = await readBody(request);
  if (!body.rawText) {
    sendJson(response, 400, { error: "rawText가 필요합니다." });
    return null;
  }

  const analysis = await analyzeBookmarks(body.rawText, body.options ?? {});
  const fingerprint = computeContentFingerprint(body.rawText);
  cacheAnalysis(fingerprint, { analysis, rawText: body.rawText });
  return {
    analysis,
    analysisContext: {
      kind: "upload",
      sourceFingerprint: fingerprint,
    },
  };
}

async function handleAnalyzePath(request, response) {
  if (!requireLocalFileAccess(response) || !requireSessionToken(request, response)) {
    return null;
  }

  const body = await readBody(request);
  if (!body.path) {
    sendJson(response, 400, { error: "path가 필요합니다." });
    return null;
  }

  const { rawText, resolvedPath } = await readBookmarksFile(body.path);
  const analysis = await analyzeBookmarks(rawText, body.options ?? {});
  const fingerprint = computeContentFingerprint(rawText);
  cacheAnalysis(fingerprint, { analysis, rawText });
  return {
    rawText,
    resolvedPath,
    analysis,
    analysisContext: {
      kind: "path",
      resolvedPath,
      sourceFingerprint: fingerprint,
    },
    backups: await listBackups(resolvedPath),
  };
}

async function handleBackup(request, response) {
  if (!requireLocalFileAccess(response) || !requireSessionToken(request, response)) {
    return null;
  }

  const body = await readBody(request);
  if (!body.path) {
    sendJson(response, 400, { error: "path가 필요합니다." });
    return null;
  }

  const { resolvedPath, rawText } = await readBookmarksFile(body.path);
  const backup = await createCompressedBackup(resolvedPath, {
    reason: body.reason ?? "manual",
    rawText,
  });

  return {
    resolvedPath,
    backup,
    backups: await listBackups(resolvedPath),
  };
}

async function handleApply(request, response) {
  if (!requireLocalFileAccess(response) || !requireSessionToken(request, response)) {
    return null;
  }

  const body = await readBody(request);
  if (!body.path || !body.analysisContext) {
    sendJson(response, 400, { error: "path와 analysisContext가 필요합니다." });
    return null;
  }

  let rawText = body.rawText;
  let analysis = body.analysis;

  if (!rawText || !analysis) {
    const fingerprint = body.analysisContext?.sourceFingerprint;
    if (fingerprint) {
      const cached = getCachedAnalysis(fingerprint);
      if (cached) {
        rawText = cached.rawText;
        analysis = cached.analysis;
      }
    }
  }

  if (!rawText || !analysis) {
    sendJson(response, 400, {
      error: "캐시에서 분석 결과를 찾을 수 없습니다. 전체 데이터를 포함하여 다시 시도하세요.",
      code: "CACHE_MISS",
    });
    return null;
  }

  const { rawText: currentRawText, resolvedPath } = await readBookmarksFile(body.path);
  const validationError = validateApplyAnalysisContext({
    analysisContext: body.analysisContext,
    requestedPath: body.path,
    resolvedPath,
    currentFingerprint: computeContentFingerprint(currentRawText),
    sourceFingerprint: computeContentFingerprint(rawText),
  });
  if (validationError) {
    sendJson(response, 409, { error: validationError });
    return null;
  }

  const backup = await createCompressedBackup(resolvedPath, {
    reason: "pre-apply",
    rawText: currentRawText,
  });

  const nextPayload = createChromeBookmarkPayload(rawText, analysis, body.options ?? {});
  await writeBookmarksFile(resolvedPath, nextPayload.content);

  evictCache(body.analysisContext.sourceFingerprint);

  const newAnalysis = await analyzeBookmarks(nextPayload.content, body.analysisOptions ?? {});
  const newFingerprint = computeContentFingerprint(nextPayload.content);
  cacheAnalysis(newFingerprint, { analysis: newAnalysis, rawText: nextPayload.content });

  return {
    resolvedPath,
    rawText: nextPayload.content,
    analysis: newAnalysis,
    analysisContext: {
      kind: "path",
      resolvedPath,
      sourceFingerprint: newFingerprint,
    },
    backup,
    backups: await listBackups(resolvedPath),
    exportedSize: nextPayload.exportedSize,
  };
}

async function handleRollback(request, response) {
  if (!requireLocalFileAccess(response) || !requireSessionToken(request, response)) {
    return null;
  }

  const body = await readBody(request);
  if (!body.path || !body.backupId) {
    sendJson(response, 400, { error: "path와 backupId가 필요합니다." });
    return null;
  }

  const restored = await restoreBackup(body.path, body.backupId);
  const analysis = await analyzeBookmarks(restored.rawText, body.analysisOptions ?? {});
  return {
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
  };
}

async function handleExport(request, response) {
  const body = await readBody(request);

  let rawText = body.rawText;
  let analysis = body.analysis;

  if (!rawText || !analysis) {
    const fingerprint = body.sourceFingerprint;
    if (fingerprint) {
      const cached = getCachedAnalysis(fingerprint);
      if (cached) {
        rawText = cached.rawText;
        analysis = cached.analysis;
      }
    }
  }

  if (!rawText || !analysis) {
    sendJson(response, 400, {
      error: "rawText와 analysis가 필요합니다. (또는 sourceFingerprint로 캐시 조회)",
      code: "CACHE_MISS",
    });
    return null;
  }

  const payload = createExportPayload(rawText, analysis, body.options ?? {});
  response.writeHead(200, {
    "Content-Type": payload.contentType,
    "Content-Disposition": `attachment; filename="bookmarks-organized.${payload.extension}"`,
  });
  response.end(payload.content);
  return null;
}

function sendSseEvent(response, event, data) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleAnalyzeStream(request, response) {
  const body = await readBody(request);
  if (!body.rawText) {
    sendJson(response, 400, { error: "rawText가 필요합니다." });
    return null;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const options = body.options ?? {};
  const analysis = await analyzeBookmarks(body.rawText, {
    ...options,
    onProgress: ({ checked, total }) => {
      sendSseEvent(response, "progress", { checked, total });
    },
  });

  const fingerprint = computeContentFingerprint(body.rawText);
  cacheAnalysis(fingerprint, { analysis, rawText: body.rawText });

  sendSseEvent(response, "result", {
    analysis,
    analysisContext: {
      kind: "upload",
      sourceFingerprint: fingerprint,
    },
  });

  response.end();
  return null;
}

async function handleAnalyzePathStream(request, response) {
  if (!requireLocalFileAccess(response) || !requireSessionToken(request, response)) {
    return null;
  }

  const body = await readBody(request);
  if (!body.path) {
    sendJson(response, 400, { error: "path가 필요합니다." });
    return null;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const { rawText, resolvedPath } = await readBookmarksFile(body.path);
  const options = body.options ?? {};
  const analysis = await analyzeBookmarks(rawText, {
    ...options,
    onProgress: ({ checked, total }) => {
      sendSseEvent(response, "progress", { checked, total });
    },
  });

  const fingerprint = computeContentFingerprint(rawText);
  cacheAnalysis(fingerprint, { analysis, rawText });

  sendSseEvent(response, "result", {
    rawText,
    resolvedPath,
    analysis,
    analysisContext: {
      kind: "path",
      resolvedPath,
      sourceFingerprint: fingerprint,
    },
    backups: await listBackups(resolvedPath),
  });

  response.end();
  return null;
}

const routes = new Map([
  ["GET /api/health", handleHealth],
  ["POST /api/session", handleSession],
  ["GET /api/backups", handleBackups],
  ["POST /api/analyze", handleAnalyze],
  ["POST /api/analyze-path", handleAnalyzePath],
  ["POST /api/backup", handleBackup],
  ["POST /api/apply", handleApply],
  ["POST /api/rollback", handleRollback],
  ["POST /api/export", handleExport],
  ["POST /api/analyze-stream", handleAnalyzeStream],
  ["POST /api/analyze-path-stream", handleAnalyzePathStream],
]);

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const routeKey = `${request.method} ${requestUrl.pathname}`;
    const handler = routes.get(routeKey);

    if (handler) {
      const result = await handler(request, response, requestUrl);
      if (result !== null && !response.writableEnded) {
        sendJson(response, 200, result);
      }
      return;
    }

    await serveStatic(response, requestUrl.pathname);
  } catch (error) {
    if (!response.writableEnded) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.",
      });
    }
  }
});

server.listen(port, host, () => {
  console.log(`Chrome Bookmark Organizer running at http://${host}:${port}`);
});
