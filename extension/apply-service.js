import { buildKeepIdSet, getModePathSegments } from "./bookmark-service.js";

async function getOrCreateFolder(parentId, title) {
  const children = await chrome.bookmarks.getChildren(parentId);
  const existing = children.find((c) => !c.url && c.title === title);
  if (existing) {
    return existing.id;
  }
  const created = await chrome.bookmarks.create({ parentId, title });
  return created.id;
}

async function removeEmptyFolders() {
  const tree = await chrome.bookmarks.getTree();
  const rootChildIds = new Set((tree[0].children || []).map((c) => c.id));

  async function prune(node) {
    if (node.url || !node.children) {
      return;
    }

    for (const child of [...node.children]) {
      await prune(child);
    }

    if (rootChildIds.has(node.id)) {
      return;
    }

    try {
      const [current] = await chrome.bookmarks.getSubTree(node.id);
      if (current && current.children && current.children.length === 0) {
        await chrome.bookmarks.remove(node.id);
      }
    } catch {
      // already removed
    }
  }

  for (const root of tree[0].children) {
    await prune(root);
  }
}

export async function applyCleanup(analysis, filterOptions) {
  const keepIds = buildKeepIdSet(analysis, filterOptions);

  for (const item of analysis.items) {
    if (!keepIds.has(item.id)) {
      try {
        await chrome.bookmarks.remove(item.id);
      } catch {
        // already removed (e.g., parent folder was removed)
      }
    }
  }

  await removeEmptyFolders();
}

export async function applyReorganize(analysis, filterOptions, mode) {
  const keepIds = buildKeepIdSet(analysis, filterOptions);
  const filteredItems = analysis.items.filter((item) => keepIds.has(item.id));

  // Remove items not in keep set
  for (const item of analysis.items) {
    if (!keepIds.has(item.id)) {
      try {
        await chrome.bookmarks.remove(item.id);
      } catch {
        // already removed
      }
    }
  }

  // Get current root folder IDs
  const tree = await chrome.bookmarks.getTree();
  const bookmarkBarId = tree[0].children[0]?.id || "1";

  // Group items by target folder path
  const groups = new Map();
  for (const item of filteredItems) {
    const segments = getModePathSegments(item, mode);
    const key = segments.join("/");
    if (!groups.has(key)) {
      groups.set(key, { segments, items: [] });
    }
    groups.get(key).items.push(item);
  }

  // Create folder structure and move bookmarks
  for (const [, group] of groups) {
    let parentId = bookmarkBarId;
    for (const segment of group.segments) {
      parentId = await getOrCreateFolder(parentId, segment);
    }

    for (const item of group.items) {
      try {
        await chrome.bookmarks.move(item.id, { parentId });
      } catch {
        // item may have been removed
      }
    }
  }

  await removeEmptyFolders();
}
