import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";

const ROOT_LABELS = {
  bookmark_bar: "북마크바",
  other: "기타 북마크",
  synced: "동기화 북마크",
};

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "ref",
  "ref_src",
  "si",
  "spm",
  "utm_campaign",
  "utm_content",
  "utm_id",
  "utm_medium",
  "utm_name",
  "utm_source",
  "utm_term",
]);

const FOLDER_PRIORITY_RE = /(important|favorite|favourite|daily|work|docs|reference|tool|quick|읽기|업무|중요|자주|참고|도구)/i;

const TOPIC_RULES = [
  {
    topic: "개발",
    weight: 16,
    domains: [
      "github.com",
      "gitlab.com",
      "stackoverflow.com",
      "developer.mozilla.org",
      "nodejs.org",
      "npmjs.com",
      "vercel.com",
      "cloudflare.com",
    ],
    patterns: [
      /\b(api|sdk|dev|developer|programming|code|coding|javascript|typescript|react|vue|node|python|java|rust|docker|kubernetes|sql|database|repo)\b/i,
      /(개발|프로그래밍|코드|문서|레포)/i,
    ],
  },
  {
    topic: "AI·데이터",
    weight: 16,
    domains: [
      "openai.com",
      "huggingface.co",
      "kaggle.com",
      "colab.research.google.com",
      "arxiv.org",
      "paperswithcode.com",
    ],
    patterns: [/\b(ai|llm|gpt|machine learning|data science|neural|prompt|model|dataset)\b/i, /(인공지능|데이터|모델|프롬프트)/i],
  },
  {
    topic: "생산성",
    weight: 14,
    domains: [
      "notion.so",
      "docs.google.com",
      "drive.google.com",
      "calendar.google.com",
      "slack.com",
      "zoom.us",
      "trello.com",
      "atlassian.net",
    ],
    patterns: [/\b(doc|docs|calendar|workspace|board|task|meeting|project|note|productivity)\b/i, /(업무|일정|노트|회의|문서)/i],
  },
  {
    topic: "디자인",
    weight: 14,
    domains: ["figma.com", "dribbble.com", "behance.net", "adobe.com", "coolors.co"],
    patterns: [/\b(design|ui|ux|font|icon|color|palette|mockup|layout)\b/i, /(디자인|색상|폰트|아이콘|레이아웃)/i],
  },
  {
    topic: "뉴스·읽을거리",
    weight: 12,
    domains: ["medium.com", "substack.com", "news.ycombinator.com", "nytimes.com", "bbc.com"],
    patterns: [/\b(news|blog|article|post|magazine|journal|story)\b/i, /(뉴스|블로그|기사|읽기)/i],
  },
  {
    topic: "쇼핑",
    weight: 12,
    domains: ["amazon.com", "coupang.com", "aliexpress.com", "11st.co.kr", "gmarket.co.kr"],
    patterns: [/\b(shop|shopping|store|market|deal|cart|mall)\b/i, /(쇼핑|구매|마켓|스토어)/i],
  },
  {
    topic: "금융",
    weight: 12,
    domains: ["paypal.com", "stripe.com", "wise.com", "investing.com", "tradingview.com"],
    patterns: [/\b(finance|stock|bank|invest|crypto|payment|tax|accounting)\b/i, /(금융|투자|주식|세금|결제)/i],
  },
  {
    topic: "영상·미디어",
    weight: 12,
    domains: ["youtube.com", "netflix.com", "twitch.tv", "vimeo.com", "spotify.com"],
    patterns: [/\b(video|stream|music|movie|watch|channel|podcast)\b/i, /(영상|음악|영화|스트리밍|채널)/i],
  },
  {
    topic: "소셜·커뮤니티",
    weight: 12,
    domains: ["x.com", "twitter.com", "linkedin.com", "facebook.com", "reddit.com", "discord.com"],
    patterns: [/\b(community|forum|social|chat|thread|discussion|network)\b/i, /(커뮤니티|포럼|소셜|채팅|토론)/i],
  },
  {
    topic: "학습·레퍼런스",
    weight: 12,
    domains: ["wikipedia.org", "coursera.org", "udemy.com", "edx.org", "khanacademy.org"],
    patterns: [/\b(learn|course|tutorial|guide|reference|manual|wiki|lesson)\b/i, /(학습|강의|튜토리얼|가이드|레퍼런스|위키)/i],
  },
  {
    topic: "여행·지도",
    weight: 12,
    domains: ["maps.google.com", "airbnb.com", "booking.com", "tripadvisor.com", "skyscanner.com"],
    patterns: [/\b(travel|flight|hotel|map|route|trip|booking)\b/i, /(여행|지도|항공|호텔|예약)/i],
  },
];

function chromeTimeToUnixMs(chromeTime) {
  if (!chromeTime) {
    return null;
  }

  const numeric = Number(chromeTime);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const windowsEpochOffsetMs = 11644473600000;

  return Math.floor(numeric / 1000 - windowsEpochOffsetMs);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol.toLowerCase();

    if (!["http:", "https:"].includes(protocol)) {
      return rawUrl.trim();
    }

    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();

    if ((protocol === "http:" && parsed.port === "80") || (protocol === "https:" && parsed.port === "443")) {
      parsed.port = "";
    }

    const keptParams = [];
    for (const [key, value] of parsed.searchParams.entries()) {
      const lowered = key.toLowerCase();
      if (TRACKING_PARAMS.has(lowered) || lowered.startsWith("utm_")) {
        continue;
      }

      keptParams.push([key, value]);
    }

    keptParams.sort(([left], [right]) => left.localeCompare(right));

    parsed.search = "";
    for (const [key, value] of keptParams) {
      parsed.searchParams.append(key, value);
    }

    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

function getHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function cleanDomain(hostname) {
  if (!hostname) {
    return "기타";
  }

  return hostname.replace(/^www\./, "");
}

function buildFolderPath(parentFolders, currentName) {
  if (!currentName) {
    return parentFolders;
  }

  return [...parentFolders, currentName];
}

function classifyTopic({ title, url, hostname, folderPath }) {
  const haystack = [title, url, hostname, folderPath.join(" ")]
    .filter(Boolean)
    .map((part) => safeDecodeURIComponent(part))
    .join(" ")
    .toLowerCase();

  let bestTopic = "기타";
  let bestScore = -1;

  for (const rule of TOPIC_RULES) {
    let score = 0;

    if (rule.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
      score += rule.weight;
    }

    for (const pattern of rule.patterns) {
      if (pattern.test(haystack)) {
        score += 8;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTopic = rule.topic;
    }
  }

  return bestScore <= 0 ? "기타" : bestTopic;
}

function summarizeBy(items, keySelector) {
  const counter = new Map();

  for (const item of items) {
    const key = keySelector(item);
    const current = counter.get(key) ?? {
      key,
      count: 0,
      deadCount: 0,
      suspectCount: 0,
      highImportanceCount: 0,
    };

    current.count += 1;
    if (item.linkStatus === "dead") {
      current.deadCount += 1;
    }
    if (item.linkStatus === "suspect") {
      current.suspectCount += 1;
    }
    if (item.importanceBucket === "높음") {
      current.highImportanceCount += 1;
    }

    counter.set(key, current);
  }

  return [...counter.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function computeRecencyScore(dateValues, dateAddedMs) {
  if (!dateValues.length || !dateAddedMs) {
    return 0;
  }

  const min = dateValues[0];
  const max = dateValues[dateValues.length - 1];

  if (max === min) {
    return 8;
  }

  const ratio = (dateAddedMs - min) / (max - min);
  return Math.round(Math.max(0, Math.min(1, ratio)) * 15);
}

function computeImportanceScore(item, dateValues) {
  const rootScore = {
    bookmark_bar: 35,
    other: 18,
    synced: 12,
  }[item.root] ?? 10;

  const depthScore = Math.max(0, 24 - item.depth * 6);
  const orderScore = Math.max(0, 12 - item.siblingIndex * 2);
  const recencyScore = computeRecencyScore(dateValues, item.dateAddedMs);
  const folderScore = item.folderPath.some((folder) => FOLDER_PRIORITY_RE.test(folder)) ? 8 : 0;
  const httpsScore = item.url.startsWith("https://") ? 4 : 0;
  const titleScore = item.title && item.title.length <= 60 ? 4 : 1;
  const duplicatePenalty = item.duplicateCount > 1 ? 12 : 0;
  const deadPenalty = item.linkStatus === "dead" ? 50 : item.linkStatus === "suspect" ? 18 : 0;

  const score = rootScore + depthScore + orderScore + recencyScore + folderScore + httpsScore + titleScore - duplicatePenalty - deadPenalty;

  return Math.max(0, score);
}

function bucketImportance(score) {
  if (score >= 70) {
    return "높음";
  }
  if (score >= 45) {
    return "중간";
  }
  return "낮음";
}

function sortByImportance(items) {
  return [...items].sort((left, right) => {
    if (right.importanceScore !== left.importanceScore) {
      return right.importanceScore - left.importanceScore;
    }

    return left.title.localeCompare(right.title, "ko");
  });
}

function buildSuggestions(summary) {
  const suggestions = [];

  if (summary.deadLinks > 0) {
    suggestions.push(`죽은 링크 ${summary.deadLinks}개를 먼저 제거하면 정리 난이도가 가장 크게 낮아진다.`);
  }
  if (summary.duplicateGroups > 0) {
    suggestions.push(`중복 그룹 ${summary.duplicateGroups}개에서 대표 북마크만 남기면 북마크 수가 빠르게 줄어든다.`);
  }
  if (summary.topTopic?.key) {
    suggestions.push(`가장 큰 주제는 "${summary.topTopic.key}"이므로 전용 폴더를 따로 두는 편이 관리가 쉽다.`);
  }
  if (summary.topDomain?.key) {
    suggestions.push(`"${summary.topDomain.key}" 도메인 북마크가 가장 많으므로 도메인 기준 정리 효과가 크다.`);
  }

  return suggestions;
}

function flattenItemsFromRoots(roots) {
  const items = [];
  let sequence = 0;

  const walk = (node, rootName, folders, depth, siblingIndex, indexPath) => {
    if (!node) {
      return;
    }

    if (node.type === "url" && node.url) {
      const normalizedUrl = normalizeUrl(node.url);
      const hostname = getHostname(node.url);
      const domain = cleanDomain(hostname);
      const title = (node.name || "").trim() || normalizedUrl;
      const dateAddedMs = chromeTimeToUnixMs(node.date_added);
      const folderPath = folders;

      items.push({
        id: node.id ?? `node-${sequence}`,
        sequence: sequence++,
        title,
        url: node.url,
        normalizedUrl,
        root: rootName,
        rootLabel: ROOT_LABELS[rootName] ?? rootName,
        folderPath,
        pathLabel: folderPath.length ? folderPath.join(" / ") : "(루트)",
        depth,
        siblingIndex,
        indexPath,
        hostname,
        domain,
        dateAddedMs,
        dateAddedISO: dateAddedMs ? new Date(dateAddedMs).toISOString() : null,
      });
      return;
    }

    if (node.type === "folder" && Array.isArray(node.children)) {
      const nextFolders = node.name ? buildFolderPath(folders, node.name) : folders;
      node.children.forEach((child, index) => {
        walk(child, rootName, nextFolders, depth + 1, index, [...indexPath, index]);
      });
    }
  };

  for (const [rootName, rootNode] of Object.entries(roots)) {
    walk(rootNode, rootName, [], 0, 0, []);
  }

  return items.map((item) => ({
    ...item,
    topic: classifyTopic(item),
  }));
}

export async function checkLinkStatuses(items, options = {}) {
  const {
    concurrency = 8,
    timeoutMs = 4500,
    mode = "quick",
    maxQuickChecks = 200,
  } = options;

  const uniqueUrls = [...new Map(items.map((item) => [item.normalizedUrl, item.url])).entries()];
  const limitedEntries =
    mode === "none" ? [] : mode === "quick" ? uniqueUrls.slice(0, maxQuickChecks) : uniqueUrls;

  const statusMap = new Map();

  for (const item of items) {
    if (!/^https?:\/\//i.test(item.url)) {
      statusMap.set(item.normalizedUrl, {
        status: "special",
        httpStatus: null,
        detail: "http/https 이외 스킴",
      });
    }
  }

  let cursor = 0;

  async function worker() {
    while (cursor < limitedEntries.length) {
      const index = cursor++;
      const [normalizedUrl, originalUrl] = limitedEntries[index];
      if (statusMap.has(normalizedUrl)) {
        continue;
      }

      statusMap.set(normalizedUrl, await probeUrl(originalUrl, timeoutMs));
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  return Object.fromEntries(statusMap);
}

async function probeUrl(url, timeoutMs) {
  const methods = ["HEAD", "GET"];

  for (const method of methods) {
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status >= 200 && response.status < 400) {
        return {
          status: "alive",
          httpStatus: response.status,
          detail: method,
        };
      }

      if ([401, 403].includes(response.status)) {
        return {
          status: "alive",
          httpStatus: response.status,
          detail: "접근 제한",
        };
      }

      if ([405, 501].includes(response.status) && method === "HEAD") {
        continue;
      }

      if ([404, 410, 451].includes(response.status)) {
        return {
          status: "dead",
          httpStatus: response.status,
          detail: method,
        };
      }

      return {
        status: "suspect",
        httpStatus: response.status,
        detail: method,
      };
    } catch (error) {
      if (method === "HEAD") {
        continue;
      }

      return {
        status: "suspect",
        httpStatus: null,
        detail: error?.message ?? "요청 실패",
      };
    }
  }

  return {
    status: "suspect",
    httpStatus: null,
    detail: "응답 없음",
  };
}

export async function analyzeBookmarks(rawText, options = {}) {
  const parsed = JSON.parse(rawText);
  if (!parsed?.roots || typeof parsed.roots !== "object") {
    throw new Error("크롬 북마크 JSON 형식이 아닙니다. roots 객체가 필요합니다.");
  }

  const items = flattenItemsFromRoots(parsed.roots);
  const duplicateCounter = new Map();

  for (const item of items) {
    duplicateCounter.set(item.normalizedUrl, (duplicateCounter.get(item.normalizedUrl) ?? 0) + 1);
  }

  const linkStatusLookup =
    options.linkStatusOverrides ??
    (await checkLinkStatuses(items, {
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      mode: options.linkCheckMode ?? "quick",
      maxQuickChecks: options.maxQuickChecks,
    }));

  const dateValues = items
    .map((item) => item.dateAddedMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  const enrichedItems = items.map((item) => {
    const linkInfo = linkStatusLookup[item.normalizedUrl] ?? {
      status: options.linkCheckMode === "none" ? "unchecked" : "unchecked",
      httpStatus: null,
      detail: "미검사",
    };

    const duplicateCount = duplicateCounter.get(item.normalizedUrl) ?? 1;
    const importanceScore = computeImportanceScore(
      {
        ...item,
        duplicateCount,
        linkStatus: linkInfo.status,
      },
      dateValues,
    );

    return {
      ...item,
      duplicateCount,
      linkStatus: linkInfo.status,
      httpStatus: linkInfo.httpStatus,
      linkDetail: linkInfo.detail,
      importanceScore,
      importanceBucket: bucketImportance(importanceScore),
    };
  });

  const duplicateGroups = [...new Map(enrichedItems.map((item) => [item.normalizedUrl, []])).entries()]
    .map(([key]) => ({
      key,
      items: sortByImportance(enrichedItems.filter((item) => item.normalizedUrl === key)),
    }))
    .filter((group) => group.items.length > 1)
    .map((group) => ({
      key: group.key,
      count: group.items.length,
      keep: group.items[0],
      items: group.items,
    }))
    .sort((left, right) => right.count - left.count || right.keep.importanceScore - left.keep.importanceScore);

  const sortedItems = sortByImportance(enrichedItems);
  const deadLinks = sortedItems.filter((item) => item.linkStatus === "dead" || item.linkStatus === "suspect");
  const domainSummary = summarizeBy(sortedItems, (item) => item.domain).slice(0, 25);
  const topicSummary = summarizeBy(sortedItems, (item) => item.topic).slice(0, 25);

  const summary = {
    totalBookmarks: sortedItems.length,
    uniqueUrls: new Set(sortedItems.map((item) => item.normalizedUrl)).size,
    deadLinks: sortedItems.filter((item) => item.linkStatus === "dead").length,
    suspectLinks: sortedItems.filter((item) => item.linkStatus === "suspect").length,
    aliveLinks: sortedItems.filter((item) => item.linkStatus === "alive").length,
    uncheckedLinks: sortedItems.filter((item) => item.linkStatus === "unchecked").length,
    specialLinks: sortedItems.filter((item) => item.linkStatus === "special").length,
    duplicateGroups: duplicateGroups.length,
    duplicateBookmarks: duplicateGroups.reduce((sum, group) => sum + group.count - 1, 0),
    topicCount: topicSummary.length,
    domainCount: domainSummary.length,
    topTopic: topicSummary[0] ?? null,
    topDomain: domainSummary[0] ?? null,
  };

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      rootLabels: ROOT_LABELS,
      sourceName: parsed.checksum ?? null,
    },
    options: {
      linkCheckMode: options.linkCheckMode ?? "quick",
      timeoutMs: options.timeoutMs ?? 4500,
      concurrency: options.concurrency ?? 8,
      maxQuickChecks: options.maxQuickChecks ?? 200,
    },
    summary,
    suggestions: buildSuggestions(summary),
    deadLinks,
    duplicateGroups,
    domainSummary,
    topicSummary,
    items: sortedItems,
  };
}

function createFolderNode(name) {
  return {
    type: "folder",
    name,
    children: [],
  };
}

function createUrlNode(item) {
  return {
    type: "url",
    name: item.title,
    url: item.url,
    addDate: item.dateAddedMs,
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addPath(rootFolder, pathSegments, item) {
  let pointer = rootFolder;
  for (const segment of pathSegments) {
    let next = pointer.children.find((child) => child.type === "folder" && child.name === segment);
    if (!next) {
      next = createFolderNode(segment);
      pointer.children.push(next);
    }
    pointer = next;
  }

  pointer.children.push(createUrlNode(item));
}

function getModePathSegments(item, mode) {
  if (mode === "topic") {
    return [item.topic];
  }

  if (mode === "domain") {
    return [item.domain];
  }

  if (mode === "importance") {
    return [item.importanceBucket];
  }

  return item.folderPath;
}

function buildKeepIdSet(analysis, filterOptions = {}) {
  const {
    removeDeadLinks = true,
    removeDuplicates = true,
  } = filterOptions;

  const dedupeKeepers = new Set(analysis.duplicateGroups.map((group) => group.keep.id));
  const keepIds = new Set();

  for (const item of analysis.items) {
    if (removeDeadLinks && (item.linkStatus === "dead" || item.linkStatus === "suspect")) {
      continue;
    }
    if (removeDuplicates && item.duplicateCount > 1 && !dedupeKeepers.has(item.id)) {
      continue;
    }
    keepIds.add(item.id);
  }

  return keepIds;
}

function getFilteredItems(analysis, filterOptions = {}) {
  const keepIds = buildKeepIdSet(analysis, filterOptions);
  const sortMode = filterOptions.sortMode ?? "importance";
  const filteredItems = analysis.items.filter((item) => keepIds.has(item.id));

  if (sortMode === "sequence") {
    return [...filteredItems].sort((left, right) => left.sequence - right.sequence);
  }

  return sortByImportance(filteredItems);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function folderToHtml(folder, indent = 1) {
  const pad = "    ".repeat(indent);
  const innerPad = "    ".repeat(indent + 1);
  const lines = [];

  for (const child of folder.children) {
    if (child.type === "folder") {
      lines.push(`${pad}<DT><H3>${escapeHtml(child.name)}</H3>`);
      lines.push(`${pad}<DL><p>`);
      lines.push(folderToHtml(child, indent + 1));
      lines.push(`${pad}</DL><p>`);
      continue;
    }

    const addDate = child.addDate ? Math.floor(child.addDate / 1000) : Math.floor(Date.now() / 1000);
    lines.push(
      `${innerPad}<DT><A HREF="${escapeHtml(child.url)}" ADD_DATE="${addDate}">${escapeHtml(child.name)}</A>`,
    );
  }

  return lines.join("\n");
}

function buildExportTree(items, mode) {
  const root = createFolderNode("Bookmarks");

  if (mode !== "original") {
    for (const item of items) {
      addPath(root, getModePathSegments(item, mode), item);
    }
    return root;
  }

  for (const item of items) {
    addPath(root, [item.rootLabel, ...item.folderPath], item);
  }
  return root;
}

function filterChromeFolderNode(node, keepIds) {
  if (!node || typeof node !== "object") {
    return node;
  }

  if (node.type === "url") {
    return keepIds.has(node.id) ? deepClone(node) : null;
  }

  if (node.type === "folder") {
    const nextNode = deepClone(node);
    nextNode.children = (node.children ?? [])
      .map((child) => filterChromeFolderNode(child, keepIds))
      .filter(Boolean);
    return nextNode;
  }

  return deepClone(node);
}

function createFilteredOriginalRoots(parsed, analysis, filterOptions = {}) {
  const keepIds = buildKeepIdSet(analysis, filterOptions);
  const nextRoots = deepClone(parsed.roots);

  for (const rootKey of ["bookmark_bar", "other", "synced"]) {
    if (parsed.roots[rootKey]?.type === "folder") {
      nextRoots[rootKey] = filterChromeFolderNode(parsed.roots[rootKey], keepIds);
    }
  }

  return {
    keepIds,
    nextRoots,
  };
}

function chromeNodeToExportNode(node) {
  if (node.type === "url") {
    return {
      type: "url",
      name: node.name,
      url: node.url,
      addDate: chromeTimeToUnixMs(node.date_added),
    };
  }

  return {
    type: "folder",
    name: node.name,
    children: (node.children ?? []).map(chromeNodeToExportNode),
  };
}

function buildOriginalExportTreeFromRoots(roots) {
  const root = createFolderNode("Bookmarks");

  for (const rootKey of ["bookmark_bar", "other", "synced"]) {
    const node = roots[rootKey];
    if (!node?.type || node.type !== "folder") {
      continue;
    }

    root.children.push({
      type: "folder",
      name: ROOT_LABELS[rootKey] ?? rootKey,
      children: (node.children ?? []).map(chromeNodeToExportNode),
    });
  }

  return root;
}

export function createExportPayload(rawText, analysis, exportOptions = {}) {
  const {
    mode = "original",
    removeDeadLinks = true,
    removeDuplicates = true,
    format = "html",
  } = exportOptions;

  const filteredItems = getFilteredItems(analysis, {
    removeDeadLinks,
    removeDuplicates,
    sortMode: mode === "original" ? "sequence" : "importance",
  });

  if (format === "json") {
    return {
      contentType: "application/json; charset=utf-8",
      extension: "json",
      content: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          mode,
          removeDeadLinks,
          removeDuplicates,
          sourceSize: analysis.summary.totalBookmarks,
          exportedSize: filteredItems.length,
          items: filteredItems,
        },
        null,
        2,
      ),
    };
  }

  const exportTree =
    mode === "original"
      ? buildOriginalExportTreeFromRoots(
          createFilteredOriginalRoots(JSON.parse(rawText), analysis, {
            removeDeadLinks,
            removeDuplicates,
          }).nextRoots,
        )
      : buildExportTree(filteredItems, mode);

  const content = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- Generated by Chrome Bookmark Organizer -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    folderToHtml(exportTree, 1),
    "</DL><p>",
  ].join("\n");

  return {
    contentType: "text/html; charset=utf-8",
    extension: "html",
    content,
  };
}

function chromeTimestampNow() {
  return String((Date.now() + 11644473600000) * 1000);
}

function collectOriginalUrlNodes(roots) {
  const urlNodes = new Map();
  let maxId = 0;

  const walk = (node) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const numericId = Number(node.id);
    if (Number.isFinite(numericId)) {
      maxId = Math.max(maxId, numericId);
    }

    if (node.type === "url" && node.id) {
      urlNodes.set(String(node.id), deepClone(node));
      return;
    }

    if (node.type === "folder" && Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  };

  for (const value of Object.values(roots)) {
    if (value?.type === "folder") {
      walk(value);
    }
  }

  return {
    urlNodes,
    maxId,
  };
}

function createChromeFolderSkeleton(name) {
  return {
    name,
    folders: new Map(),
    items: [],
  };
}

function addChromePath(rootFolder, pathSegments, urlNode) {
  let pointer = rootFolder;
  for (const segment of pathSegments) {
    let next = pointer.folders.get(segment);
    if (!next) {
      next = createChromeFolderSkeleton(segment);
      pointer.folders.set(segment, next);
    }
    pointer = next;
  }

  pointer.items.push(urlNode);
}

function createChromeFolderNode(name, allocateId, childSkeleton, timestamp) {
  return {
    id: String(allocateId()),
    guid: randomUUID().toLowerCase(),
    name,
    type: "folder",
    date_added: timestamp,
    date_modified: timestamp,
    children: materializeChromeChildren(childSkeleton, allocateId, timestamp),
  };
}

function materializeChromeChildren(folderSkeleton, allocateId, timestamp) {
  const folderNodes = [...folderSkeleton.folders.keys()]
    .sort((left, right) => left.localeCompare(right, "ko"))
    .map((folderName) =>
      createChromeFolderNode(folderName, allocateId, folderSkeleton.folders.get(folderName), timestamp),
    );

  return [...folderNodes, ...folderSkeleton.items];
}

function applyChildrenToRoots(parsed, analysis, options = {}) {
  const {
    mode = "original",
    removeDeadLinks = true,
    removeDuplicates = true,
  } = options;

  const filteredItems = getFilteredItems(analysis, {
    removeDeadLinks,
    removeDuplicates,
  });

  const { urlNodes, maxId } = collectOriginalUrlNodes(parsed.roots);
  const allocateId = (() => {
    let current = maxId;
    return () => ++current;
  })();

  const rootSkeletons = new Map();
  for (const rootKey of Object.keys(parsed.roots)) {
    if (parsed.roots[rootKey]?.type === "folder") {
      rootSkeletons.set(rootKey, createChromeFolderSkeleton(rootKey));
    }
  }

  for (const item of filteredItems) {
    const urlNode = deepClone(urlNodes.get(String(item.id)) ?? {
      id: String(allocateId()),
      guid: randomUUID().toLowerCase(),
      name: item.title,
      type: "url",
      url: item.url,
      date_added: item.dateAddedMs ? String((item.dateAddedMs + 11644473600000) * 1000) : chromeTimestampNow(),
    });

    const rootKey = rootSkeletons.has(item.root) ? item.root : "other";
    const pathSegments = getModePathSegments(item, mode);
    addChromePath(rootSkeletons.get(rootKey), pathSegments, urlNode);
  }

  const timestamp = chromeTimestampNow();
  const nextRoots = deepClone(parsed.roots);

  for (const [rootKey, skeleton] of rootSkeletons.entries()) {
    const template = nextRoots[rootKey] ?? {};
    nextRoots[rootKey] = {
      ...template,
      id: String(template.id ?? allocateId()),
      guid: template.guid ?? randomUUID().toLowerCase(),
      name: template.name ?? ROOT_LABELS[rootKey] ?? rootKey,
      type: "folder",
      date_added: template.date_added ?? timestamp,
      date_modified: timestamp,
      children: materializeChromeChildren(skeleton, allocateId, timestamp),
    };
  }

  return {
    filteredItems,
    nextRoots,
  };
}

function updateChecksumWithString(hash, value) {
  hash.update(String(value ?? ""), "utf8");
}

function updateChecksumWithTitle(hash, value) {
  hash.update(Buffer.from(String(value ?? ""), "utf16le"));
}

function updateChecksumWithNode(hash, node) {
  updateChecksumWithString(hash, node.id);
  updateChecksumWithTitle(hash, node.name);
  updateChecksumWithString(hash, node.type);

  if (node.type === "url") {
    updateChecksumWithString(hash, node.url);
    return;
  }

  for (const child of node.children ?? []) {
    updateChecksumWithNode(hash, child);
  }
}

function computeChromeChecksum(roots) {
  const hash = createHash("md5");
  for (const key of ["bookmark_bar", "other", "synced"]) {
    if (roots[key]) {
      updateChecksumWithNode(hash, roots[key]);
    }
  }
  return hash.digest("hex").toUpperCase();
}

export function createChromeBookmarkPayload(rawText, analysis, applyOptions = {}) {
  const parsed = JSON.parse(rawText);
  if (!parsed?.roots || typeof parsed.roots !== "object") {
    throw new Error("크롬 북마크 JSON 형식이 아닙니다. roots 객체가 필요합니다.");
  }

  const { nextRoots, filteredItems } =
    applyOptions.mode === "original"
      ? {
          ...createFilteredOriginalRoots(parsed, analysis, applyOptions),
          filteredItems: getFilteredItems(analysis, {
            ...applyOptions,
            sortMode: "sequence",
          }),
        }
      : applyChildrenToRoots(parsed, analysis, applyOptions);
  const nextPayload = {
    version: parsed.version ?? 1,
    roots: nextRoots,
    checksum: computeChromeChecksum(nextRoots),
  };

  if (parsed.sync_metadata) {
    nextPayload.sync_metadata = parsed.sync_metadata;
  }

  return {
    contentType: "application/json; charset=utf-8",
    extension: "json",
    content: JSON.stringify(nextPayload, null, 2),
    exportedSize: filteredItems.length,
  };
}

export function getDefaultChromePaths(homeDirectory = os.homedir()) {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const candidates = [
    `${homeDirectory}/.config/google-chrome/Default/Bookmarks`,
    `${homeDirectory}/.config/chromium/Default/Bookmarks`,
    `${homeDirectory}/Library/Application Support/Google/Chrome/Default/Bookmarks`,
    localAppData ? path.join(localAppData, "Google", "Chrome", "User Data", "Default", "Bookmarks") : "",
  ];

  return candidates.filter(Boolean);
}
