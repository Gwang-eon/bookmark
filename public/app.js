const state = {
  rawText: "",
  analysis: null,
  analysisContext: null,
  currentPath: "",
  backups: [],
  backupStorePath: "",
  localFileAccessMode: true,
  mode: "local",
  sessionToken: "",
};

const fileInput = document.getElementById("fileInput");
const pathInput = document.getElementById("pathInput");
const pathSuggestions = document.getElementById("pathSuggestions");
const loadCard = document.getElementById("loadCard");
const linkCheckMode = document.getElementById("linkCheckMode");
const timeoutMs = document.getElementById("timeoutMs");
const analyzeFileButton = document.getElementById("analyzeFileButton");
const analyzePathButton = document.getElementById("analyzePathButton");
const resultsSection = document.getElementById("resultsSection");
const statusBox = document.getElementById("statusBox");
const summaryCards = document.getElementById("summaryCards");
const suggestionList = document.getElementById("suggestionList");
const domainTable = document.getElementById("domainTable");
const topicTable = document.getElementById("topicTable");
const deadLinksTable = document.getElementById("deadLinksTable");
const duplicateList = document.getElementById("duplicateList");
const bookmarkTable = document.getElementById("bookmarkTable");
const searchInput = document.getElementById("searchInput");
const sortSelect = document.getElementById("sortSelect");
const downloadButton = document.getElementById("downloadButton");
const exportMode = document.getElementById("exportMode");
const exportFormat = document.getElementById("exportFormat");
const removeDeadLinks = document.getElementById("removeDeadLinks");
const removeSuspectLinks = document.getElementById("removeSuspectLinks");
const removeDuplicates = document.getElementById("removeDuplicates");
const backupStorePath = document.getElementById("backupStorePath");
const localAccessCard = document.getElementById("localAccessCard");
const backupButton = document.getElementById("backupButton");
const applyButton = document.getElementById("applyButton");
const refreshBackupsButton = document.getElementById("refreshBackupsButton");
const backupTable = document.getElementById("backupTable");

function setStatus(message, type = "info") {
  statusBox.textContent = message;
  statusBox.style.background =
    type === "error" ? "rgba(182, 81, 36, 0.12)" : "rgba(14, 124, 102, 0.08)";
  statusBox.style.color = type === "error" ? "#9d4318" : "#0b5f4f";
}

function getAnalysisOptions() {
  return {
    linkCheckMode: linkCheckMode.value,
    timeoutMs: Number(timeoutMs.value || 4500),
  };
}

function getCleanupOptions() {
  return {
    mode: exportMode.value,
    removeDeadLinks: removeDeadLinks.checked,
    removeSuspectLinks: removeSuspectLinks.checked,
    removeDuplicates: removeDuplicates.checked,
  };
}

function getTargetPath() {
  return pathInput.value.trim() || state.currentPath;
}

function buildRequestHeaders(includeSessionToken = false) {
  const headers = {};
  if (includeSessionToken && state.sessionToken) {
    headers["x-bookmark-organizer-token"] = state.sessionToken;
  }
  return headers;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function badge(text, kind) {
  return `<span class="badge ${kind}">${escapeHtml(text)}</span>`;
}

function renderTable(columns, rows) {
  if (!rows.length) {
    return `<p>표시할 항목이 없다.</p>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSummary(analysis) {
  const cards = [
    ["전체 북마크", analysis.summary.totalBookmarks],
    ["중복 제거 가능 수", analysis.summary.duplicateBookmarks],
    ["죽은 링크", analysis.summary.deadLinks],
    ["의심 링크", analysis.summary.suspectLinks],
    ["고유 URL", analysis.summary.uniqueUrls],
    ["도메인 수", analysis.summary.domainCount],
    ["주제 수", analysis.summary.topicCount],
    ["살아 있는 링크", analysis.summary.aliveLinks],
  ];

  summaryCards.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="summary-card">
          <span>${escapeHtml(label)}</span>
          <strong>${value}</strong>
        </article>`,
    )
    .join("");
}

function renderSuggestions(analysis) {
  suggestionList.innerHTML = analysis.suggestions.length
    ? analysis.suggestions.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")
    : `<span class="pill">바로 제거할 항목이 많지 않다. 폴더 정책을 먼저 정하면 된다.</span>`;
}

function renderDomainAndTopicTables(analysis) {
  const domainLimit = 12;
  domainTable.innerHTML = renderTable(
    [
      { label: "도메인", render: (row) => escapeHtml(row.key) },
      { label: "북마크 수", render: (row) => String(row.count) },
      { label: "죽은 링크", render: (row) => String(row.deadCount) },
      { label: "높은 중요도", render: (row) => String(row.highImportanceCount) },
    ],
    analysis.domainSummary.slice(0, domainLimit),
  ) + truncationNotice(analysis.domainSummary.length, domainLimit);

  const topicLimit = 12;
  topicTable.innerHTML = renderTable(
    [
      { label: "주제", render: (row) => escapeHtml(row.key) },
      { label: "북마크 수", render: (row) => String(row.count) },
      { label: "죽은 링크", render: (row) => String(row.deadCount) },
      { label: "높은 중요도", render: (row) => String(row.highImportanceCount) },
    ],
    analysis.topicSummary.slice(0, topicLimit),
  ) + truncationNotice(analysis.topicSummary.length, topicLimit);
}

function truncationNotice(total, limit) {
  if (total <= limit) {
    return "";
  }
  return `<p class="truncation-notice">외 ${total - limit}건이 더 있습니다. (총 ${total}건 중 ${limit}건 표시)</p>`;
}

function renderDeadLinks(analysis) {
  const limit = 50;
  deadLinksTable.innerHTML = renderTable(
    [
      { label: "상태", render: (row) => badge(row.linkStatus, row.linkStatus) },
      { label: "제목", render: (row) => escapeHtml(row.title) },
      {
        label: "URL",
        render: (row) =>
          `<a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.domain)}</a>`,
      },
      { label: "폴더", render: (row) => escapeHtml(`${row.rootLabel} / ${row.pathLabel}`) },
      {
        label: "응답",
        render: (row) => escapeHtml(row.httpStatus ? String(row.httpStatus) : row.linkDetail || "-"),
      },
    ],
    analysis.deadLinks.slice(0, limit),
  ) + truncationNotice(analysis.deadLinks.length, limit);
}

function renderDuplicates(analysis) {
  if (!analysis.duplicateGroups.length) {
    duplicateList.innerHTML = "<p>중복 그룹이 없다.</p>";
    return;
  }

  const limit = 20;
  duplicateList.innerHTML = analysis.duplicateGroups
    .slice(0, limit)
    .map(
      (group) => `
        <article class="duplicate-card">
          <strong>${escapeHtml(group.keep.title)}</strong>
          <p>${escapeHtml(group.key)}</p>
          <p>중복 ${group.count}개, 대표 유지: ${escapeHtml(group.keep.rootLabel)} / ${escapeHtml(group.keep.pathLabel)}</p>
        </article>`,
    )
    .join("") + truncationNotice(analysis.duplicateGroups.length, limit);
}

function getVisibleItems() {
  if (!state.analysis) {
    return [];
  }

  const query = searchInput.value.trim().toLowerCase();
  const items = [...state.analysis.items];

  if (query) {
    return items.filter((item) =>
      [item.title, item.url, item.domain, item.topic, item.pathLabel, item.rootLabel]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }

  return items;
}

function sortItems(items) {
  switch (sortSelect.value) {
    case "title":
      return items.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    case "domain":
      return items.sort((a, b) => a.domain.localeCompare(b.domain, "ko") || b.importanceScore - a.importanceScore);
    case "topic":
      return items.sort((a, b) => a.topic.localeCompare(b.topic, "ko") || b.importanceScore - a.importanceScore);
    default:
      return items.sort((a, b) => b.importanceScore - a.importanceScore);
  }
}

function renderBookmarks() {
  const allItems = sortItems(getVisibleItems());
  const limit = 200;
  const items = allItems.slice(0, limit);
  bookmarkTable.innerHTML = renderTable(
    [
      { label: "제목", render: (row) => escapeHtml(row.title) },
      {
        label: "중요도",
        render: (row) =>
          `${badge(row.importanceBucket, row.importanceBucket === "높음" ? "high" : row.importanceBucket === "중간" ? "medium" : "low")} <strong>${row.importanceScore}</strong>`,
      },
      { label: "주제", render: (row) => escapeHtml(row.topic) },
      { label: "도메인", render: (row) => escapeHtml(row.domain) },
      { label: "상태", render: (row) => badge(row.linkStatus, row.linkStatus) },
      { label: "폴더", render: (row) => escapeHtml(`${row.rootLabel} / ${row.pathLabel}`) },
    ],
    items,
  ) + truncationNotice(allItems.length, limit);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return "-";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderBackups() {
  if (!state.backups.length) {
    backupTable.innerHTML = "<p>이 경로에 저장된 백업이 없다.</p>";
    return;
  }

  backupTable.innerHTML = renderTable(
    [
      {
        label: "생성 시각",
        render: (row) => escapeHtml(new Date(row.createdAt).toLocaleString("ko-KR")),
      },
      { label: "사유", render: (row) => escapeHtml(row.reason) },
      {
        label: "크기",
        render: (row) => `${escapeHtml(formatSize(row.compressedSize))} / 원본 ${escapeHtml(formatSize(row.originalSize))}`,
      },
      {
        label: "롤백",
        render: (row) =>
          `<button class="button rollback-button" data-backup-id="${escapeHtml(row.id)}">이 백업으로 복원</button>`,
      },
    ],
    state.backups,
  );
}

function updateLocalModeUi() {
  if (!state.localFileAccessMode) {
    analyzePathButton.disabled = true;
    backupButton.disabled = true;
    applyButton.disabled = true;
    refreshBackupsButton.disabled = true;
    pathInput.disabled = true;
    localAccessCard.classList.add("hidden");
    const hintList = loadCard.querySelector(".hint-list");
    if (!hintList.dataset.remoteHintAdded) {
      hintList.innerHTML += "<p>remote 모드에서는 업로드 기반 분석만 사용할 수 있다.</p>";
      hintList.dataset.remoteHintAdded = "true";
    }
    return;
  }

  pathInput.disabled = false;
  analyzePathButton.disabled = false;
  backupButton.disabled = false;
  refreshBackupsButton.disabled = false;
}

function updateApplyAvailability() {
  const canApply =
    state.localFileAccessMode &&
    state.analysisContext?.kind === "path" &&
    Boolean(state.currentPath) &&
    Boolean(state.rawText) &&
    Boolean(state.analysis);

  applyButton.disabled = !canApply;
  applyButton.title = canApply ? "" : "직접 적용은 현재 경로를 다시 분석한 결과에서만 가능하다.";
}

function renderPathSuggestions(paths) {
  pathSuggestions.innerHTML = paths.map((item) => `<option value="${escapeHtml(item)}"></option>`).join("");
}

function renderAnalysis(analysis) {
  renderSummary(analysis);
  renderSuggestions(analysis);
  renderDomainAndTopicTables(analysis);
  renderDeadLinks(analysis);
  renderDuplicates(analysis);
  renderBookmarks();
  renderBackups();
  resultsSection.classList.remove("hidden");
}

async function postSseJson(url, payload, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildRequestHeaders(options.includeSessionToken),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "요청 실패" }));
    throw new Error(error.error || "요청 실패");
  }

  return new Promise((resolve, reject) => {
    let result = null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    function processChunk({ done, value }) {
      if (done) {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("스트림이 결과 없이 종료되었습니다."));
        }
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      let currentEvent = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === "progress" && options.onProgress) {
            options.onProgress(data);
          } else if (currentEvent === "result") {
            result = data;
          }
        }
      }

      reader.read().then(processChunk).catch(reject);
    }

    reader.read().then(processChunk).catch(reject);
  });
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "요청 실패" }));
    throw new Error(error.error || "요청 실패");
  }
  return response.json();
}

async function postJson(url, payload, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildRequestHeaders(options.includeSessionToken),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "요청 실패" }));
    throw new Error(error.error || "요청 실패");
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.blob();
}

async function refreshBackups() {
  const targetPath = getTargetPath();
  if (!state.localFileAccessMode || !targetPath) {
    state.backups = [];
    renderBackups();
    return;
  }

  const response = await fetch(`/api/backups?path=${encodeURIComponent(targetPath)}`, {
    headers: buildRequestHeaders(true),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "요청 실패" }));
    throw new Error(error.error || "요청 실패");
  }
  const payload = await response.json();
  state.currentPath = payload.resolvedPath;
  pathInput.value = payload.resolvedPath;
  state.backups = payload.backups;
  renderBackups();
  updateApplyAvailability();
}

backupTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".rollback-button");
  if (!button) {
    return;
  }

  const targetPath = getTargetPath();
  if (!targetPath) {
    setStatus("먼저 대상 Bookmarks 경로를 지정해야 한다.", "error");
    return;
  }

  if (!confirm("선택한 백업으로 롤백합니다. 현재 파일은 자동 백업됩니다. 계속하시겠습니까?")) {
    return;
  }

  setStatus("선택한 백업으로 롤백 중이다.");
  try {
    const payload = await postJson("/api/rollback", {
      path: targetPath,
      backupId: button.dataset.backupId,
      analysisOptions: getAnalysisOptions(),
    }, { includeSessionToken: true });

    state.currentPath = payload.resolvedPath;
    pathInput.value = payload.resolvedPath;
    state.rawText = payload.rawText;
    state.analysis = payload.analysis;
    state.analysisContext = payload.analysisContext;
    state.backups = payload.backups;
    renderAnalysis(payload.analysis);
    setStatus(`롤백 완료: ${payload.restoredBackup.createdAt} 백업으로 복원했다.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

analyzeFileButton.addEventListener("click", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    setStatus("분석할 JSON 파일을 먼저 선택해야 한다.", "error");
    return;
  }

  setStatus("파일을 읽고 북마크를 분석 중이다.");
  try {
    state.currentPath = getTargetPath();
    state.rawText = await file.text();
    const payload = await postSseJson("/api/analyze-stream", {
      rawText: state.rawText,
      options: getAnalysisOptions(),
    }, {
      onProgress: ({ checked, total }) => {
        setStatus(`링크 검사 중: ${checked} / ${total}`);
      },
    });
    state.analysis = payload.analysis;
    state.analysisContext = payload.analysisContext;
    await refreshBackups().catch(() => {
      state.backups = [];
    });
    renderAnalysis(payload.analysis);
    updateApplyAvailability();
    setStatus(`분석 완료: 북마크 ${payload.analysis.summary.totalBookmarks}개`);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

analyzePathButton.addEventListener("click", async () => {
  if (!pathInput.value.trim()) {
    setStatus("파일 경로를 입력해야 한다.", "error");
    return;
  }

  setStatus("로컬 경로에서 북마크 파일을 읽고 분석 중이다.");
  try {
    const payload = await postSseJson("/api/analyze-path-stream", {
      path: pathInput.value.trim(),
      options: getAnalysisOptions(),
    }, {
      includeSessionToken: true,
      onProgress: ({ checked, total }) => {
        setStatus(`링크 검사 중: ${checked} / ${total}`);
      },
    });
    state.currentPath = payload.resolvedPath;
    pathInput.value = payload.resolvedPath;
    state.rawText = payload.rawText;
    state.analysis = payload.analysis;
    state.analysisContext = payload.analysisContext;
    state.backups = payload.backups;
    renderAnalysis(payload.analysis);
    updateApplyAvailability();
    setStatus(`분석 완료: 북마크 ${payload.analysis.summary.totalBookmarks}개`);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

searchInput.addEventListener("input", renderBookmarks);
sortSelect.addEventListener("change", renderBookmarks);

downloadButton.addEventListener("click", async () => {
  if (!state.rawText || !state.analysis) {
    setStatus("먼저 북마크를 분석해야 한다.", "error");
    return;
  }

  setStatus("정리된 파일을 생성 중이다.");
  try {
    const blob = await postJson("/api/export", {
      rawText: state.rawText,
      analysis: state.analysis,
      options: {
        ...getCleanupOptions(),
        format: exportFormat.value,
      },
    });

    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `bookmarks-organized.${exportFormat.value}`;
    anchor.click();
    URL.revokeObjectURL(href);
    setStatus("다운로드를 시작했다.");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

backupButton.addEventListener("click", async () => {
  const targetPath = getTargetPath();
  if (!targetPath) {
    setStatus("백업할 Bookmarks 경로를 먼저 입력해야 한다.", "error");
    return;
  }

  setStatus("현재 Bookmarks 파일을 gzip 백업 중이다.");
  try {
    const payload = await postJson("/api/backup", {
      path: targetPath,
      reason: "manual",
    }, { includeSessionToken: true });
    state.currentPath = payload.resolvedPath;
    pathInput.value = payload.resolvedPath;
    state.backups = payload.backups;
    renderBackups();
    updateApplyAvailability();
    setStatus("백업을 생성했다.");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

applyButton.addEventListener("click", async () => {
  const targetPath = getTargetPath();
  if (!targetPath) {
    setStatus("적용할 Bookmarks 경로를 먼저 입력해야 한다.", "error");
    return;
  }
  if (!state.rawText || !state.analysis) {
    setStatus("먼저 분석 결과가 있어야 한다.", "error");
    return;
  }

  if (!confirm(`"${targetPath}" 파일에 정리본을 직접 적용합니다.\n기존 파일은 자동 백업됩니다. 계속하시겠습니까?`)) {
    return;
  }

  setStatus("현재 파일을 백업한 뒤 정리본을 직접 적용 중이다.");
  try {
    const payload = await postJson("/api/apply", {
      path: targetPath,
      rawText: state.rawText,
      analysis: state.analysis,
      analysisContext: state.analysisContext,
      options: getCleanupOptions(),
      analysisOptions: getAnalysisOptions(),
    }, { includeSessionToken: true });

    state.currentPath = payload.resolvedPath;
    pathInput.value = payload.resolvedPath;
    state.rawText = payload.rawText;
    state.analysis = payload.analysis;
    state.analysisContext = payload.analysisContext;
    state.backups = payload.backups;
    renderAnalysis(payload.analysis);
    updateApplyAvailability();
    setStatus(`적용 완료: ${payload.exportedSize}개 북마크를 현재 경로에 반영했다.`);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

refreshBackupsButton.addEventListener("click", async () => {
  try {
    await refreshBackups();
    setStatus("백업 목록을 새로 읽었다.");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

async function bootstrap() {
  try {
    const health = await getJson("/api/health");
    state.backupStorePath = health.backupStorePath;
    state.localFileAccessMode = Boolean(health.localFileAccessMode);
    state.mode = health.mode;
    backupStorePath.textContent = health.backupStorePath || "remote 모드";

    if (state.localFileAccessMode) {
      try {
        const session = await postJson("/api/session", {});
        state.sessionToken = session.sessionToken || "";
      } catch {
        state.sessionToken = "";
      }
    }
    updateLocalModeUi();

    if (Array.isArray(health.detectedChromePaths) && health.detectedChromePaths.length) {
      renderPathSuggestions(health.detectedChromePaths);
      if (!pathInput.value.trim()) {
        pathInput.value = health.detectedChromePaths[0];
        state.currentPath = health.detectedChromePaths[0];
      }
    } else if (!pathInput.value && Array.isArray(health.defaultChromePaths) && health.defaultChromePaths.length) {
      pathInput.placeholder = `예: ${health.defaultChromePaths[0]}`;
    }
  } catch {
    backupStorePath.textContent = "확인 실패";
  }

  updateApplyAvailability();
}

bootstrap();
