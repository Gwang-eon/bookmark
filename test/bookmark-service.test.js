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

function createOriginalStructureBookmarks(baseUrl) {
  return JSON.stringify({
    version: 1,
    checksum: "sample",
    roots: {
      bookmark_bar: {
        id: "100",
        guid: "00000000-0000-4000-8000-000000000100",
        name: "bookmark_bar",
        type: "folder",
        date_added: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
        date_modified: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
        children: [
          {
            id: "10",
            guid: "00000000-0000-4000-8000-000000000010",
            name: "Folder A",
            type: "folder",
            date_added: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
            date_modified: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
            children: [
              {
                type: "url",
                id: "1",
                guid: "00000000-0000-4000-8000-000000000001",
                name: "Keep Me",
                url: `${baseUrl}/alive`,
                date_added: chromeTimestampFromDate("2025-01-01T00:00:00Z"),
              },
              {
                type: "url",
                id: "2",
                guid: "00000000-0000-4000-8000-000000000002",
                name: "Remove Me",
                url: `${baseUrl}/missing`,
                date_added: chromeTimestampFromDate("2025-01-02T00:00:00Z"),
              },
            ],
          },
          {
            id: "11",
            guid: "00000000-0000-4000-8000-000000000011",
            name: "Empty Folder",
            type: "folder",
            date_added: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
            date_modified: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
            children: [],
          },
        ],
      },
      other: {
        id: "101",
        guid: "00000000-0000-4000-8000-000000000101",
        name: "other",
        type: "folder",
        date_added: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
        date_modified: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
        children: [],
      },
      synced: {
        id: "102",
        guid: "00000000-0000-4000-8000-000000000102",
        name: "synced",
        type: "folder",
        date_added: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
        date_modified: chromeTimestampFromDate("2024-01-01T00:00:00Z"),
        children: [],
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

test("probeUrl treats rate limit and transient failures as suspect", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/alive")) {
      return new Response("ok", { status: 200 });
    }
    if (String(url).includes("/missing")) {
      return new Response("slow down", { status: 429 });
    }
    throw new Error("network down");
  };

  try {
    const analysis = await analyzeBookmarks(createSampleBookmarks("https://fixtures.example"), {
      linkCheckMode: "full",
      concurrency: 2,
      timeoutMs: 1500,
    });

    assert.equal(analysis.summary.deadLinks, 0);
    assert.equal(analysis.summary.suspectLinks, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createChromeBookmarkPayload preserves original folder structure in original mode", async () => {
  const rawText = createOriginalStructureBookmarks("https://example.com");
  const analysis = await analyzeBookmarks(rawText, {
    linkCheckMode: "none",
    linkStatusOverrides: {
      "https://example.com/alive": { status: "alive", httpStatus: 200, detail: "fixture" },
      "https://example.com/missing": { status: "dead", httpStatus: 404, detail: "fixture" },
    },
  });

  const payload = createChromeBookmarkPayload(rawText, analysis, {
    mode: "original",
    removeDeadLinks: true,
    removeDuplicates: false,
  });
  const parsed = JSON.parse(payload.content);
  const children = parsed.roots.bookmark_bar.children;

  assert.equal(parsed.roots.bookmark_bar.id, "100");
  assert.equal(children[0].id, "10");
  assert.equal(children[0].children.length, 1);
  assert.equal(children[0].children[0].id, "1");
  assert.equal(children[1].id, "11");
  assert.equal(children[1].children.length, 0);
});
