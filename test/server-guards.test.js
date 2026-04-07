import test from "node:test";
import assert from "node:assert/strict";
import {
  computeContentFingerprint,
  createSessionToken,
  hasValidSessionToken,
  readRequestToken,
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

test("hasValidSessionToken rejects empty or missing token", () => {
  assert.equal(hasValidSessionToken({}, "abc123"), false);
  assert.equal(hasValidSessionToken({ "x-bookmark-organizer-token": "" }, "abc123"), false);
  assert.equal(hasValidSessionToken({ "x-bookmark-organizer-token": "abc123" }, ""), false);
});

test("readRequestToken handles array header values", () => {
  assert.equal(readRequestToken({ "x-bookmark-organizer-token": ["first", "second"] }), "first");
  assert.equal(readRequestToken({ "x-bookmark-organizer-token": [] }), "");
  assert.equal(readRequestToken({}), "");
});

test("createSessionToken generates unique tokens", () => {
  const tokens = new Set(Array.from({ length: 10 }, () => createSessionToken()));
  assert.equal(tokens.size, 10);
});

test("computeContentFingerprint is deterministic", () => {
  const a = computeContentFingerprint("hello world");
  const b = computeContentFingerprint("hello world");
  const c = computeContentFingerprint("hello world!");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("validateApplyAnalysisContext rejects mismatched sourceFingerprint", () => {
  const fp1 = computeContentFingerprint("data-v1");
  const fp2 = computeContentFingerprint("data-v2");

  assert.match(
    validateApplyAnalysisContext({
      analysisContext: {
        kind: "path",
        resolvedPath: "/tmp/Bookmarks",
        sourceFingerprint: fp1,
      },
      requestedPath: "/tmp/Bookmarks",
      resolvedPath: "/tmp/Bookmarks",
      currentFingerprint: fp1,
      sourceFingerprint: fp2,
    }),
    /원본 스냅샷.*일치하지 않습니다/,
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
