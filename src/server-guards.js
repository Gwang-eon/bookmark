import { createHash, randomUUID } from "node:crypto";

export function createSessionToken() {
  return randomUUID();
}

export function computeContentFingerprint(rawText) {
  return createHash("sha256").update(rawText, "utf8").digest("hex");
}

export function readRequestToken(headers) {
  const value = headers["x-bookmark-organizer-token"];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export function hasValidSessionToken(headers, expectedToken) {
  return Boolean(expectedToken) && readRequestToken(headers) === expectedToken;
}

export function validateApplyAnalysisContext({
  analysisContext,
  requestedPath,
  resolvedPath,
  currentFingerprint,
  sourceFingerprint,
}) {
  if (!analysisContext || analysisContext.kind !== "path") {
    return "직접 적용은 경로 기반으로 다시 분석한 결과에서만 허용됩니다.";
  }

  if (!requestedPath || !resolvedPath || analysisContext.resolvedPath !== resolvedPath) {
    return "분석한 원본 경로와 현재 적용 대상 경로가 일치하지 않습니다.";
  }

  if (!analysisContext.sourceFingerprint || analysisContext.sourceFingerprint !== sourceFingerprint) {
    return "분석 결과의 원본 스냅샷과 현재 적용 요청 데이터가 일치하지 않습니다. 다시 분석한 뒤 적용해야 합니다.";
  }

  if (analysisContext.sourceFingerprint !== currentFingerprint) {
    return "현재 Bookmarks 파일이 분석 이후 변경되었습니다. 다시 분석한 뒤 적용해야 합니다.";
  }

  return null;
}
