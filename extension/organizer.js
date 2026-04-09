import { analyzeBookmarks, createExportPayload } from "./bookmark-service.js";
import { chromeApiTreeToRawText } from "./bridge.js";
import { applyCleanup, applyReorganize } from "./apply-service.js";
import { createBackup, listBackups, restoreBackup } from "./backup-service.js";
import { msg, localizeHtml, getBucketDisplayName, getBucketCssClass, getLocale } from "./i18n.js";

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
    return `<p>${msg("table_empty")}</p>`;
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
    [msg("summary_total"), analysis.summary.totalBookmarks],
    [msg("summary_duplicates"), analysis.summary.duplicateBookmarks],
    [msg("summary_dead"), analysis.summary.deadLinks],
    [msg("summary_suspect"), analysis.summary.suspectLinks],
    [msg("summary_unique"), analysis.summary.uniqueUrls],
    [msg("summary_domains"), analysis.summary.domainCount],
    [msg("summary_topics"), analysis.summary.topicCount],
    [msg("summary_alive"), analysis.summary.aliveLinks],
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
    : `<span class="pill">${msg("suggestion_none")}</span>`;
}

function renderDomainAndTopicTables(analysis) {
  const domainLimit = 12;
  domainTable.innerHTML = renderTable(
    [
      { label: msg("col_domain"), render: (row) => escapeHtml(row.key) },
      { label: msg("col_bookmark_count"), render: (row) => String(row.count) },
      { label: msg("col_dead_links"), render: (row) => String(row.deadCount) },
      { label: msg("col_high_importance"), render: (row) => String(row.highImportanceCount) },
    ],
    analysis.domainSummary.slice(0, domainLimit),
  ) + truncationNotice(analysis.domainSummary.length, domainLimit);

  const topicLimit = 12;
  topicTable.innerHTML = renderTable(
    [
      { label: msg("col_topic"), render: (row) => escapeHtml(row.key) },
      { label: msg("col_bookmark_count"), render: (row) => String(row.count) },
      { label: msg("col_dead_links"), render: (row) => String(row.deadCount) },
      { label: msg("col_high_importance"), render: (row) => String(row.highImportanceCount) },
    ],
    analysis.topicSummary.slice(0, topicLimit),
  ) + truncationNotice(analysis.topicSummary.length, topicLimit);
}

function truncationNotice(total, limit) {
  if (total <= limit) {
    return "";
  }
  return `<p class="truncation-notice">${msg("truncation_notice", [String(total - limit), String(total), String(limit)])}</p>`;
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
      { label: msg("col_status"), render: (row) => badge(row.linkStatus, row.linkStatus) },
      { label: msg("col_title"), render: (row) => escapeHtml(row.title) },
      {
        label: msg("col_url"),
        render: (row) => {
          if (isSafeUrl(row.url)) {
            return `<a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.domain)}</a>`;
          }
          return escapeHtml(row.domain);
        },
      },
      { label: msg("col_folder"), render: (row) => escapeHtml(`${row.rootLabel} / ${row.pathLabel}`) },
      {
        label: msg("col_response"),
        render: (row) => escapeHtml(row.httpStatus ? String(row.httpStatus) : row.linkDetail || "-"),
      },
    ],
    analysis.deadLinks.slice(0, limit),
  ) + truncationNotice(analysis.deadLinks.length, limit);
}

function renderDuplicates(analysis) {
  if (!analysis.duplicateGroups.length) {
    duplicateList.innerHTML = `<p>${msg("no_duplicate_groups")}</p>`;
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
          <p>${msg("duplicate_info", [String(group.count), group.keep.rootLabel, group.keep.pathLabel])}</p>
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
      return items.sort((a, b) => a.title.localeCompare(b.title, getLocale()));
    case "domain":
      return items.sort((a, b) => a.domain.localeCompare(b.domain, getLocale()) || b.importanceScore - a.importanceScore);
    case "topic":
      return items.sort((a, b) => a.topic.localeCompare(b.topic, getLocale()) || b.importanceScore - a.importanceScore);
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
      ? msg("selection_with_exclusion", [String(totalItems - excludedCount), String(excludedCount), String(totalItems)])
      : msg("selection_all_included", [String(totalItems)]);
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
        rawLabel: `<input type="checkbox" id="selectAllCheckbox" ${allVisibleSelected ? "checked" : ""} title="${msg("select_all_title")}">`,
        render: (row) => {
          const checked = !state.excludedItemIds.has(row.id);
          return `<input type="checkbox" class="bookmark-select" data-item-id="${escapeHtml(row.id)}" ${checked ? "checked" : ""}>`;
        },
      },
      { label: msg("col_title"), render: (row) => escapeHtml(row.title) },
      {
        label: msg("col_importance"),
        render: (row) =>
          `${badge(getBucketDisplayName(row.importanceBucket), getBucketCssClass(row.importanceBucket))} <strong>${row.importanceScore}</strong>`,
      },
      { label: msg("col_topic"), render: (row) => escapeHtml(row.topic) },
      { label: msg("col_domain"), render: (row) => escapeHtml(row.domain) },
      { label: msg("col_status"), render: (row) => badge(row.linkStatus, row.linkStatus) },
      { label: msg("col_folder"), render: (row) => escapeHtml(`${row.rootLabel} / ${row.pathLabel}`) },
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
    backupTable.innerHTML = `<p>${msg("no_backups")}</p>`;
    return;
  }

  backupTable.innerHTML = renderTable(
    [
      {
        label: msg("col_created"),
        render: (row) => escapeHtml(new Date(row.createdAt).toLocaleString(getLocale())),
      },
      { label: msg("col_reason"), render: (row) => escapeHtml(row.reason) },
      {
        label: msg("col_size"),
        render: (row) => escapeHtml(formatSize(row.size || row.compressedSize || 0)),
      },
      {
        label: msg("col_rollback"),
        render: (row) =>
          `<button class="button rollback-button" data-backup-id="${escapeHtml(row.id)}">${msg("btn_rollback")}</button>`,
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
  setStatus(msg("status_analyzing"));
  analyzeButton.disabled = true;
  try {
    const tree = await chrome.bookmarks.getTree();
    state.rawText = chromeApiTreeToRawText(tree);
    const analysis = await analyzeBookmarks(state.rawText, {
      ...getAnalysisOptions(),
      onProgress: ({ checked, total }) => {
        setStatus(msg("status_link_checking", [String(checked), String(total)]));
      },
    });
    state.analysis = analysis;
    state.excludedItemIds = new Set();
    state.backups = await listBackups();
    renderAnalysis(analysis);
    updateApplyAvailability();
    setStatus(msg("status_analysis_complete", [String(analysis.summary.totalBookmarks)]));
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
    setStatus(msg("status_analyze_first"), "error");
    return;
  }
  setStatus(msg("status_generating_file"));
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
    setStatus(msg("status_download_started"));
  } catch (error) {
    setStatus(error.message, "error");
  }
});

backupButton.addEventListener("click", async () => {
  if (operationInProgress) {
    setStatus(msg("status_operation_in_progress"), "error");
    return;
  }
  setOperationLock(true);
  setStatus(msg("status_backing_up"));
  try {
    await createBackup("manual");
    state.backups = await listBackups();
    renderBackups();
    setStatus(msg("status_backup_created"));
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setOperationLock(false);
  }
});

applyButton.addEventListener("click", async () => {
  if (operationInProgress) {
    setStatus(msg("status_operation_in_progress"), "error");
    return;
  }
  if (!state.analysis) {
    setStatus(msg("status_need_analysis"), "error");
    return;
  }
  if (!confirm(msg("confirm_apply"))) {
    return;
  }
  setOperationLock(true);
  setStatus(msg("status_applying"));
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
    setStatus(msg("status_apply_complete"));
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
    setStatus(msg("status_backups_refreshed"));
  } catch (error) {
    setStatus(error.message, "error");
  }
});

backupTable.addEventListener("click", async (event) => {
  const button = event.target.closest(".rollback-button");
  if (!button) return;
  if (operationInProgress) {
    setStatus(msg("status_operation_in_progress"), "error");
    return;
  }
  if (!confirm(msg("confirm_rollback"))) return;
  setOperationLock(true);
  setStatus(msg("status_rolling_back"));
  try {
    await restoreBackup(button.dataset.backupId);
    const tree = await chrome.bookmarks.getTree();
    state.rawText = chromeApiTreeToRawText(tree);
    state.analysis = await analyzeBookmarks(state.rawText, getAnalysisOptions());
    state.excludedItemIds = new Set();
    state.backups = await listBackups();
    renderAnalysis(state.analysis);
    setStatus(msg("status_rollback_complete"));
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setOperationLock(false);
  }
});

async function bootstrap() {
  localizeHtml();
  try {
    state.backups = await listBackups();
    renderBackups();
  } catch {
    // ignore
  }
  updateApplyAvailability();
}

bootstrap();
