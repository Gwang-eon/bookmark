import test from "node:test";
import assert from "node:assert/strict";
import {
  computeContentFingerprint,
  hasValidSessionToken,
  validateApplyAnalysisContext,
} from "../src/server-guards.js";

test("hasValidSessionToken matches request header", () => {
  assert.equal(
    hasValidSessionToken({ "x-bookmark-organizer-token": "abc123" }, "abc123"),
    true,
  );
  assert.equal(
    hasValidSessionToken({ "x-bookmark-organizer-token": "wrong" }, "abc123"),
    false,
  );
});

test("validateApplyAnalysisContext rejects mismatched sources", () => {
  const sourceFingerprint = computeContentFingerprint("source");
  const currentFingerprint = computeContentFingerprint("current");

  assert.match(
    validateApplyAnalysisContext({
      analysisContext: { kind: "upload", sourceFingerprint },
      requestedPath: "/tmp/Bookmarks",
      resolvedPath: "/tmp/Bookmarks",
      currentFingerprint,
      sourceFingerprint,
    }),
    /경로 기반/,
  );

  assert.match(
    validateApplyAnalysisContext({
      analysisContext: {
        kind: "path",
        resolvedPath: "/tmp/Other",
        sourceFingerprint,
      },
      requestedPath: "/tmp/Bookmarks",
      resolvedPath: "/tmp/Bookmarks",
      currentFingerprint: sourceFingerprint,
      sourceFingerprint,
    }),
    /경로가 일치하지 않습니다/,
  );

  assert.match(
    validateApplyAnalysisContext({
      analysisContext: {
        kind: "path",
        resolvedPath: "/tmp/Bookmarks",
        sourceFingerprint,
      },
      requestedPath: "/tmp/Bookmarks",
      resolvedPath: "/tmp/Bookmarks",
      currentFingerprint,
      sourceFingerprint,
    }),
    /분석 이후 변경/,
  );
});

test("validateApplyAnalysisContext accepts matching path context", () => {
  const fingerprint = computeContentFingerprint("same");

  assert.equal(
    validateApplyAnalysisContext({
      analysisContext: {
        kind: "path",
        resolvedPath: "/tmp/Bookmarks",
        sourceFingerprint: fingerprint,
      },
      requestedPath: "/tmp/Bookmarks",
      resolvedPath: "/tmp/Bookmarks",
      currentFingerprint: fingerprint,
      sourceFingerprint: fingerprint,
    }),
    null,
  );
});
