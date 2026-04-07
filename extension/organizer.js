import { analyzeBookmarks, createExportPayload } from "./bookmark-service.js";
import { chromeApiTreeToRawText } from "./bridge.js";
import { applyCleanup, applyReorganize } from "./apply-service.js";
import { createBackup, listBackups, restoreBackup } from "./backup-service.js";

const state = {
  rawText: "",
  analysis: null,
  backups: [],
  excludedItemIds: new Set(),
};

const analyzeButton = document.getElementById("analyzeButton");
const linkCheckMode = document.getElementById("linkCheckMode");
const timeoutMs = document.getElementById("timeoutMs");
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
          <tr>${columns.map((column) => `<th>${column.rawLabel ?? escapeHtml(column.label)}</th>`).join("")}</tr>
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
          <strong>${escapeHtml(String(value))}</strong>
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

function isSafeUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function renderDeadLinks(analysis) {
  const limit = 50;
  deadLinksTable.innerHTML = renderTable(
    [
      { label: "상태", render: (row) => badge(row.linkStatus, row.linkStatus) },
      { label: "제목", render: (row) => escapeHtml(row.title) },
      {
        label: "URL",
        render: (row) => {
          if (isSafeUrl(row.url)) {
            return `<a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.domain)}</a>`;
          }
          return escapeHtml(row.domain);
        },
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

function updateSelectionSummary() {
  const totalItems = state.analysis?.items.length ?? 0;
  const excludedCount = state.excludedItemIds.size;
  const summaryEl = document.getElementById("selectionSummary");
  if (summaryEl) {
    summaryEl.textContent = excludedCount > 0
      ? `${totalItems - excludedCount}개 포함 / ${excludedCount}개 제외 (전체 ${totalItems}개)`
      : `전체 ${totalItems}개 포함`;
  }
}

function renderBookmarks() {
  const allItems = sortItems(getVisibleItems());
  const limit = 200;
  const items = allItems.slice(0, limit);
  const allVisibleSelected = items.length > 0 && items.every((item) => !state.excludedItemIds.has(item.id));
  bookmarkTable.innerHTML = renderTable(
    [
      {
        rawLabel: `<input type="checkbox" id="selectAllCheckbox" ${allVisibleSelected ? "checked" : ""} title="현재 표시된 항목 전체 선택/해제">`,
        render: (row) => {
          const checked = !state.excludedItemIds.has(row.id);
          return `<input type="checkbox" class="bookmark-select" data-item-id="${escapeHtml(row.id)}" ${checked ? "checked" : ""}>`;
        },
      },
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
  updateSelectionSummary();
  const selectionToolbar = document.getElementById("selectionToolbar");
  if (selectionToolbar) {
    selectionToolbar.classList.toggle("hidden", !state.analysis);
  }
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
        render: (row) => escapeHtml(formatSize(row.size || row.compressedSize || 0)),
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

function updateApplyAvailability() {
  const canApply = Boolean(state.analysis);
  applyButton.disabled = !canApply;
}

let operationInProgress = false;

function setOperationLock(locked) {
  operationInProgress = locked;
  applyButton.disabled = locked || !state.analysis;
  backupButton.disabled = locked;
  refreshBackupsButton.disabled = locked;
  for (const btn of backupTable.querySelectorAll(".rollback-button")) {
    btn.disabled = locked;
  }
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

bookmarkTable.addEventListener("change", (event) => {
  if (event.target.id === "selectAllCheckbox") {
    const visibleItems = sortItems(getVisibleItems()).slice(0, 200);
    if (event.target.checked) {
      for (const item of visibleItems) {
        state.excludedItemIds.delete(item.id);
      }
    } else {
      for (const item of visibleItems) {
        state.excludedItemIds.add(item.id);
      }
    }
    renderBookmarks();
    return;
  }

  const checkbox = event.target.closest(".bookmark-select");
  if (!checkbox) {
    return;
  }

  const itemId = checkbox.dataset.itemId;
  if (checkbox.checked) {
    state.excludedItemIds.delete(itemId);
  } else {
    state.excludedItemIds.add(itemId);
  }
  updateSelectionSummary();
});

document.getElementById("includeAllButton").addEventListener("click", () => {
  state.excludedItemIds.clear();
  renderBookmarks();
});

document.getElementById("excludeAllButton").addEventListener("click", () => {
  if (!state.analysis) {
    return;
  }
  for (const item of state.analysis.items) {
    state.excludedItemIds.add(item.id);
  }
  renderBookmarks();
});

analyzeButton.addEventListener("click", async () => {
  setStatus("브라우저 북마크를 읽고 분석 중이다.");
  analyzeButton.disabled = true;
  try {
    const tree = await chrome.bookmarks.getTree();
    state.rawText = chromeApiTreeToRawText(tree);
    const analysis = await analyzeBookmarks(state.rawText, {
      ...getAnalysisOptions(),
      onProgress: ({ checked, total }) => {
        setStatus(`링크 검사 중: ${checked} / ${total}`);
      },
    });
    state.analysis = analysis;
    state.excludedItemIds = new Set();
    state.backups = await listBackups();
    renderAnalysis(analysis);
    updateApplyAvailability();
    setStatus(`분석 완료: 북마크 ${analysis.summary.totalBookmarks}개`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    analyzeButton.disabled = false;
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
    const payload = createExportPayload(state.rawText, state.analysis, {
      ...getCleanupOptions(),
      format: exportFormat.value,
      excludedIds: [...state.excludedItemIds],
    });
    const blob = new Blob([payload.content], { type: payload.contentType });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `bookmarks-organized.${payload.extension}`;
    anchor.click();
    URL.revokeObjectURL(href);
    setStatus("다운로드를 시작했다.");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

backupButton.addEventListener("click", async () => {
  if (operationInProgress) {
    setStatus("다른 작업이 진행 중입니다.", "error");
    return;
  }
  setOperationLock(true);
  setStatus("현재 북마크를 백업 중이다.");
  try {
    await createBackup("manual");
    state.backups = await listBackups();
    renderBackups();
    setStatus("백업을 생성했다.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setOperationLock(false);
  }
});

applyButton.addEventListener("click", async () => {
  if (operationInProgress) {
    setStatus("다른 작업이 진행 중입니다.", "error");
    return;
  }
  if (!state.analysis) {
    setStatus("먼저 분석 결과가 있어야 한다.", "error");
    return;
  }
  if (!confirm("정리본을 브라우저 북마크에 직접 적용합니다.\n현재 북마크는 자동 백업됩니다. 계속하시겠습니까?")) {
    return;
  }
  setOperationLock(true);
  setStatus("현재 북마크를 백업한 뒤 정리본을 적용 중이다.");
  try {
    await createBackup("pre-apply");
    const options = { ...getCleanupOptions(), excludedIds: [...state.excludedItemIds] };
    if (options.mode === "original") {
      await applyCleanup(state.analysis, options);
    } else {
      await applyReorganize(state.analysis, options, options.mode);
    }
    const tree = await chrome.bookmarks.getTree();
    state.rawText = chromeApiTreeToRawText(tree);
    state.analysis = await analyzeBookmarks(state.rawText, getAnalysisOptions());
    state.excludedItemIds = new Set();
    state.backups = await listBackups();
    renderAnalysis(state.analysis);
    updateApplyAvailability();
    setStatus("적용 완료.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setOperationLock(false);
  }
});

refreshBackupsButton.addEventListener("click", async () => {
  try {
    state.backups = await listBackups();
    renderBackups();
    setStatus("백업 목록을 새로 읽었다.");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

backupTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".rollback-button");
  if (!button) return;
  if (operationInProgress) {
    setStatus("다른 작업이 진행 중입니다.", "error");
    return;
  }
  if (!confirm("선택한 백업으로 롤백합니다. 현재 북마크는 자동 백업됩니다. 계속하시겠습니까?")) return;
  setOperationLock(true);
  setStatus("선택한 백업으로 롤백 중이다.");
  try {
    await restoreBackup(button.dataset.backupId);
    const tree = await chrome.bookmarks.getTree();
    state.rawText = chromeApiTreeToRawText(tree);
    state.analysis = await analyzeBookmarks(state.rawText, getAnalysisOptions());
    state.excludedItemIds = new Set();
    state.backups = await listBackups();
    renderAnalysis(state.analysis);
    setStatus("롤백 완료.");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setOperationLock(false);
  }
});

async function bootstrap() {
  try {
    state.backups = await listBackups();
    renderBackups();
  } catch {
    // ignore
  }
  updateApplyAvailability();
}

bootstrap();
