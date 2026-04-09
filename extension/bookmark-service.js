import { msg, getLocale, getBucketDisplayName } from "./i18n.js";

function getRootLabels() {
  return {
    bookmark_bar: msg("root_bookmark_bar"),
    other: msg("root_other"),
    synced: msg("root_synced"),
  };
}

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

let _folderPriorityReCache = null;
function getFolderPriorityRe() {
  if (_folderPriorityReCache) return _folderPriorityReCache;
  const localPatterns = msg("pattern_folder_priority");
  _folderPriorityReCache = new RegExp(`(important|favorite|favourite|daily|work|docs|reference|tool|quick|${localPatterns})`, "i");
  return _folderPriorityReCache;
}

let _topicRulesCache = null;
function getTopicRules() {
  if (_topicRulesCache) return _topicRulesCache;
  _topicRulesCache = [
    {
      topic: msg("topic_development"),
      weight: 16,
      domains: ["github.com", "gitlab.com", "stackoverflow.com", "developer.mozilla.org", "nodejs.org", "npmjs.com", "vercel.com", "cloudflare.com"],
      patterns: [
        /\b(api|sdk|dev|developer|programming|code|coding|javascript|typescript|react|vue|node|python|java|rust|docker|kubernetes|sql|database|repo)\b/i,
        new RegExp(msg("pattern_development"), "i"),
      ],
    },
    {
      topic: msg("topic_ai_data"),
      weight: 16,
      domains: ["openai.com", "huggingface.co", "kaggle.com", "colab.research.google.com", "arxiv.org", "paperswithcode.com"],
      patterns: [
        /\b(ai|llm|gpt|machine learning|data science|neural|prompt|model|dataset)\b/i,
        new RegExp(msg("pattern_ai_data"), "i"),
      ],
    },
    {
      topic: msg("topic_productivity"),
      weight: 14,
      domains: ["notion.so", "docs.google.com", "drive.google.com", "calendar.google.com", "slack.com", "zoom.us", "trello.com", "atlassian.net"],
      patterns: [
        /\b(doc|docs|calendar|workspace|board|task|meeting|project|note|productivity)\b/i,
        new RegExp(msg("pattern_productivity"), "i"),
      ],
    },
    {
      topic: msg("topic_design"),
      weight: 14,
      domains: ["figma.com", "dribbble.com", "behance.net", "adobe.com", "coolors.co"],
      patterns: [
        /\b(design|ui|ux|font|icon|color|palette|mockup|layout)\b/i,
        new RegExp(msg("pattern_design"), "i"),
      ],
    },
    {
      topic: msg("topic_news"),
      weight: 12,
      domains: ["medium.com", "substack.com", "news.ycombinator.com", "nytimes.com", "bbc.com"],
      patterns: [
        /\b(news|blog|article|post|magazine|journal|story)\b/i,
        new RegExp(msg("pattern_news"), "i"),
      ],
    },
    {
      topic: msg("topic_shopping"),
      weight: 12,
      domains: ["amazon.com", "coupang.com", "aliexpress.com", "11st.co.kr", "gmarket.co.kr"],
      patterns: [
        /\b(shop|shopping|store|market|deal|cart|mall)\b/i,
        new RegExp(msg("pattern_shopping"), "i"),
      ],
    },
    {
      topic: msg("topic_finance"),
      weight: 12,
      domains: ["paypal.com", "stripe.com", "wise.com", "investing.com", "tradingview.com"],
      patterns: [
        /\b(finance|stock|bank|invest|crypto|payment|tax|accounting)\b/i,
        new RegExp(msg("pattern_finance"), "i"),
      ],
    },
    {
      topic: msg("topic_media"),
      weight: 12,
      domains: ["youtube.com", "netflix.com", "twitch.tv", "vimeo.com", "spotify.com"],
      patterns: [
        /\b(video|stream|music|movie|watch|channel|podcast)\b/i,
        new RegExp(msg("pattern_media"), "i"),
      ],
    },
    {
      topic: msg("topic_social"),
      weight: 12,
      domains: ["x.com", "twitter.com", "linkedin.com", "facebook.com", "reddit.com", "discord.com"],
      patterns: [
        /\b(community|forum|social|chat|thread|discussion|network)\b/i,
        new RegExp(msg("pattern_social"), "i"),
      ],
    },
    {
      topic: msg("topic_learning"),
      weight: 12,
      domains: ["wikipedia.org", "coursera.org", "udemy.com", "edx.org", "khanacademy.org"],
      patterns: [
        /\b(learn|course|tutorial|guide|reference|manual|wiki|lesson)\b/i,
        new RegExp(msg("pattern_learning"), "i"),
      ],
    },
    {
      topic: msg("topic_travel"),
      weight: 12,
      domains: ["maps.google.com", "airbnb.com", "booking.com", "tripadvisor.com", "skyscanner.com"],
      patterns: [
        /\b(travel|flight|hotel|map|route|trip|booking)\b/i,
        new RegExp(msg("pattern_travel"), "i"),
      ],
    },
  ];
  return _topicRulesCache;
}

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
    return msg("domain_other");
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

  let bestTopic = msg("topic_other");
  let bestScore = -1;

  for (const rule of getTopicRules()) {
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

  return bestScore <= 0 ? msg("topic_other") : bestTopic;
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
    if (item.importanceBucket === "high") {
      current.highImportanceCount += 1;
    }

    counter.set(key, current);
  }

  return [...counter.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, getLocale()));
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

const IMPORTANCE_WEIGHTS = {
  root: { bookmark_bar: 35, other: 18, synced: 12, fallback: 10 },
  depthBase: 24,
  depthStep: 6,
  orderBase: 12,
  orderStep: 2,
  folderPriority: 8,
  https: 4,
  titleGood: 4,
  titleWeak: 1,
  titleMaxLength: 60,
  duplicatePenalty: 12,
  deadPenalty: 50,
  suspectPenalty: 18,
};

function computeImportanceScore(item, dateValues) {
  const w = IMPORTANCE_WEIGHTS;
  const rootScore = w.root[item.root] ?? w.root.fallback;
  const depthScore = Math.max(0, w.depthBase - item.depth * w.depthStep);
  const orderScore = Math.max(0, w.orderBase - item.siblingIndex * w.orderStep);
  const recencyScore = computeRecencyScore(dateValues, item.dateAddedMs);
  const folderScore = item.folderPath.some((folder) => getFolderPriorityRe().test(folder)) ? w.folderPriority : 0;
  const httpsScore = item.url.startsWith("https://") ? w.https : 0;
  const titleScore = item.title && item.title.length <= w.titleMaxLength ? w.titleGood : w.titleWeak;
  const duplicatePenalty = item.duplicateCount > 1 ? w.duplicatePenalty : 0;
  const deadPenalty = item.linkStatus === "dead" ? w.deadPenalty : item.linkStatus === "suspect" ? w.suspectPenalty : 0;

  const score = rootScore + depthScore + orderScore + recencyScore + folderScore + httpsScore + titleScore - duplicatePenalty - deadPenalty;

  return Math.max(0, score);
}

function bucketImportance(score) {
  if (score >= 70) {
    return "high";
  }
  if (score >= 45) {
    return "medium";
  }
  return "low";
}

function sortByImportance(items) {
  return [...items].sort((left, right) => {
    if (right.importanceScore !== left.importanceScore) {
      return right.importanceScore - left.importanceScore;
    }

    return left.title.localeCompare(right.title, getLocale());
  });
}

function buildSuggestions(summary) {
  const suggestions = [];

  if (summary.deadLinks > 0) {
    suggestions.push(msg("suggestion_dead_links", [String(summary.deadLinks)]));
  }
  if (summary.duplicateGroups > 0) {
    suggestions.push(msg("suggestion_duplicates", [String(summary.duplicateGroups)]));
  }
  if (summary.topTopic?.key) {
    suggestions.push(msg("suggestion_top_topic", [summary.topTopic.key]));
  }
  if (summary.topDomain?.key) {
    suggestions.push(msg("suggestion_top_domain", [summary.topDomain.key]));
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
        rootLabel: getRootLabels()[rootName] ?? rootName,
        folderPath,
        pathLabel: folderPath.length ? folderPath.join(" / ") : msg("path_root"),
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
    onProgress = null,
  } = options;

  const uniqueUrls = [...new Map(items.map((item) => [item.normalizedUrl, item.url])).entries()];
  const limitedEntries =
    mode === "none" ? [] : mode === "quick" ? uniqueUrls.slice(0, maxQuickChecks) : uniqueUrls;

  const statusMap = new Map();
  const total = limitedEntries.length;
  let checked = 0;

  for (const item of items) {
    if (!/^https?:\/\//i.test(item.url)) {
      statusMap.set(item.normalizedUrl, {
        status: "special",
        httpStatus: null,
        detail: msg("link_detail_non_http"),
      });
    }
  }

  let cursor = 0;

  async function worker() {
    while (cursor < limitedEntries.length) {
      const index = cursor++;
      const [normalizedUrl, originalUrl] = limitedEntries[index];
      if (statusMap.has(normalizedUrl)) {
        checked++;
        if (onProgress) {
          onProgress({ checked, total });
        }
        continue;
      }

      statusMap.set(normalizedUrl, await probeUrl(originalUrl, timeoutMs));
      checked++;
      if (onProgress) {
        onProgress({ checked, total });
      }
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
        credentials: "omit",
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
          detail: msg("link_detail_restricted"),
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
        detail: error?.message ?? msg("link_detail_request_failed"),
      };
    }
  }

  return {
    status: "suspect",
    httpStatus: null,
    detail: msg("link_detail_no_response"),
  };
}

export async function analyzeBookmarks(rawText, options = {}) {
  const parsed = JSON.parse(rawText);
  if (!parsed?.roots || typeof parsed.roots !== "object") {
    throw new Error(msg("error_invalid_json"));
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
      onProgress: options.onProgress ?? null,
    }));

  const dateValues = items
    .map((item) => item.dateAddedMs)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  const enrichedItems = items.map((item) => {
    const linkInfo = linkStatusLookup[item.normalizedUrl] ?? {
      status: options.linkCheckMode === "none" ? "unchecked" : "unchecked",
      httpStatus: null,
      detail: msg("link_detail_unchecked"),
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

  const duplicateGroupMap = new Map();
  for (const item of enrichedItems) {
    let group = duplicateGroupMap.get(item.normalizedUrl);
    if (!group) {
      group = [];
      duplicateGroupMap.set(item.normalizedUrl, group);
    }
    group.push(item);
  }

  const duplicateGroups = [...duplicateGroupMap.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => {
      const sorted = sortByImportance(items);
      return { key, count: sorted.length, keep: sorted[0], items: sorted };
    })
    .sort((left, right) => right.count - left.count || right.keep.importanceScore - left.keep.importanceScore);

  const sortedItems = sortByImportance(enrichedItems);
  const deadLinks = sortedItems.filter((item) => item.linkStatus === "dead" || item.linkStatus === "suspect");
  const domainSummary = summarizeBy(sortedItems, (item) => item.domain).slice(0, 25);
  const topicSummary = summarizeBy(sortedItems, (item) => item.topic).slice(0, 25);

  const linkStatusCounts = { dead: 0, suspect: 0, alive: 0, unchecked: 0, special: 0 };
  const uniqueUrlSet = new Set();
  for (const item of sortedItems) {
    if (linkStatusCounts[item.linkStatus] !== undefined) {
      linkStatusCounts[item.linkStatus]++;
    }
    uniqueUrlSet.add(item.normalizedUrl);
  }

  const summary = {
    totalBookmarks: sortedItems.length,
    uniqueUrls: uniqueUrlSet.size,
    deadLinks: linkStatusCounts.dead,
    suspectLinks: linkStatusCounts.suspect,
    aliveLinks: linkStatusCounts.alive,
    uncheckedLinks: linkStatusCounts.unchecked,
    specialLinks: linkStatusCounts.special,
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
      rootLabels: getRootLabels(),
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
  return structuredClone(value);
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

export function getModePathSegments(item, mode) {
  if (mode === "topic") {
    return [item.topic];
  }

  if (mode === "domain") {
    return [item.domain];
  }

  if (mode === "importance") {
    return [getBucketDisplayName(item.importanceBucket)];
  }

  return item.folderPath;
}

export function buildKeepIdSet(analysis, filterOptions = {}) {
  const {
    removeDeadLinks = true,
    removeSuspectLinks = false,
    removeDuplicates = true,
    excludedIds = [],
  } = filterOptions;

  const excludeSet = new Set(excludedIds);
  const dedupeKeepers = new Set(analysis.duplicateGroups.map((group) => group.keep.id));
  const keepIds = new Set();

  for (const item of analysis.items) {
    if (excludeSet.has(item.id)) {
      continue;
    }
    if (removeDeadLinks && item.linkStatus === "dead") {
      continue;
    }
    if (removeSuspectLinks && item.linkStatus === "suspect") {
      continue;
    }
    if (removeDuplicates && item.duplicateCount > 1 && !dedupeKeepers.has(item.id)) {
      continue;
    }
    keepIds.add(item.id);
  }

  return keepIds;
}

export function getFilteredItems(analysis, filterOptions = {}) {
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
      name: getRootLabels()[rootKey] ?? rootKey,
      children: (node.children ?? []).map(chromeNodeToExportNode),
    });
  }

  return root;
}

export function createExportPayload(rawText, analysis, exportOptions = {}) {
  const {
    mode = "original",
    removeDeadLinks = true,
    removeSuspectLinks = false,
    removeDuplicates = true,
    excludedIds = [],
    format = "html",
  } = exportOptions;

  const filteredItems = getFilteredItems(analysis, {
    removeDeadLinks,
    removeSuspectLinks,
    removeDuplicates,
    excludedIds,
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
    guid: crypto.randomUUID().toLowerCase(),
    name,
    type: "folder",
    date_added: timestamp,
    date_modified: timestamp,
    children: materializeChromeChildren(childSkeleton, allocateId, timestamp),
  };
}

function materializeChromeChildren(folderSkeleton, allocateId, timestamp) {
  const folderNodes = [...folderSkeleton.folders.keys()]
    .sort((left, right) => left.localeCompare(right, getLocale()))
    .map((folderName) =>
      createChromeFolderNode(folderName, allocateId, folderSkeleton.folders.get(folderName), timestamp),
    );

  return [...folderNodes, ...folderSkeleton.items];
}

function applyChildrenToRoots(parsed, analysis, options = {}) {
  const {
    mode = "original",
    removeDeadLinks = true,
    removeSuspectLinks = false,
    removeDuplicates = true,
    excludedIds = [],
  } = options;

  const filteredItems = getFilteredItems(analysis, {
    removeDeadLinks,
    removeSuspectLinks,
    removeDuplicates,
    excludedIds,
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
      guid: crypto.randomUUID().toLowerCase(),
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
      guid: template.guid ?? crypto.randomUUID().toLowerCase(),
      name: template.name ?? getRootLabels()[rootKey] ?? rootKey,
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

export function createChromeBookmarkPayload(rawText, analysis, applyOptions = {}) {
  const parsed = JSON.parse(rawText);
  if (!parsed?.roots || typeof parsed.roots !== "object") {
    throw new Error(msg("error_invalid_json"));
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
