import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBookmarks, createChromeBookmarkPayload, createExportPayload } from "../src/bookmark-service.js";

function chromeTimestampFromDate(dateString) {
  const unixMs = new Date(dateString).getTime();
  return String((unixMs + 11644473600000) * 1000);
}

function createSampleBookmarks(baseUrl) {
  return JSON.stringify({
    checksum: "sample",
    roots: {
      bookmark_bar: {
        children: [
          {
            type: "folder",
            name: "개발",
            children: [
              {
                type: "url",
                id: "1",
                name: "GitHub Repo",
                url: `${baseUrl}/alive`,
                date_added: chromeTimestampFromDate("2025-12-01T00:00:00Z"),
              },
              {
                type: "url",
                id: "2",
                name: "GitHub Repo Duplicate",
                url: `${baseUrl}/alive?utm_source=test`,
                date_added: chromeTimestampFromDate("2025-12-02T00:00:00Z"),
              },
            ],
          },
        ],
        type: "folder",
      },
      other: {
        children: [
          {
            type: "url",
            id: "3",
            name: "Dead Link",
            url: `${baseUrl}/missing`,
            date_added: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
          },
        ],
        type: "folder",
      },
      synced: {
        children: [
          {
            type: "url",
            id: "4",
            name: "OpenAI Docs",
            url: "https://openai.com/docs",
            date_added: chromeTimestampFromDate("2026-01-01T00:00:00Z"),
          },
        ],
        type: "folder",
      },
    },
  });
}

test("analyzeBookmarks detects duplicates and dead links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/alive") || String(url).includes("openai.com/docs")) {
      return new Response("ok", { status: 200 });
    }

    return new Response("missing", { status: 404 });
  };

  try {
    const analysis = await analyzeBookmarks(createSampleBookmarks("https://fixtures.example"), {
      linkCheckMode: "full",
      concurrency: 2,
      timeoutMs: 1500,
    });

    assert.equal(analysis.summary.totalBookmarks, 4);
    assert.equal(analysis.summary.duplicateGroups, 1);
    assert.equal(analysis.summary.deadLinks, 1);
    assert.equal(analysis.deadLinks[0].title, "Dead Link");
    assert.equal(analysis.duplicateGroups[0].count, 2);
    assert.ok(analysis.topicSummary.some((entry) => entry.key === "개발"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createExportPayload removes dead links and duplicate extras", async () => {
  const analysis = await analyzeBookmarks(createSampleBookmarks("https://example.com"), {
    linkCheckMode: "none",
    linkStatusOverrides: {
      "https://example.com/alive": { status: "alive", httpStatus: 200, detail: "fixture" },
      "https://example.com/missing": { status: "dead", httpStatus: 404, detail: "fixture" },
      "https://openai.com/docs": { status: "alive", httpStatus: 200, detail: "fixture" },
    },
  });

  const payload = createExportPayload("", analysis, {
    mode: "topic",
    format: "html",
    removeDeadLinks: true,
    removeDuplicates: true,
  });

  assert.equal(payload.extension, "html");
  assert.match(payload.content, /NETSCAPE-Bookmark-file-1/);
  assert.match(payload.content, /OpenAI Docs/);
  assert.doesNotMatch(payload.content, /Dead Link/);
});

test("createChromeBookmarkPayload builds Chrome JSON with checksum", async () => {
  const analysis = await analyzeBookmarks(createSampleBookmarks("https://example.com"), {
    linkCheckMode: "none",
    linkStatusOverrides: {
      "https://example.com/alive": { status: "alive", httpStatus: 200, detail: "fixture" },
      "https://example.com/missing": { status: "dead", httpStatus: 404, detail: "fixture" },
      "https://openai.com/docs": { status: "alive", httpStatus: 200, detail: "fixture" },
    },
  });

  const payload = createChromeBookmarkPayload(createSampleBookmarks("https://example.com"), analysis, {
    mode: "topic",
    removeDeadLinks: true,
    removeDuplicates: true,
  });

  const parsed = JSON.parse(payload.content);
  const reappliedAnalysis = await analyzeBookmarks(payload.content, {
    linkCheckMode: "none",
    linkStatusOverrides: {
      "https://example.com/alive": { status: "alive", httpStatus: 200, detail: "fixture" },
      "https://openai.com/docs": { status: "alive", httpStatus: 200, detail: "fixture" },
    },
  });

  assert.match(parsed.checksum, /^[A-F0-9]{32}$/);
  assert.equal(parsed.version, 1);
  assert.equal(reappliedAnalysis.summary.totalBookmarks, 2);
  assert.equal(payload.exportedSize, 2);
});
