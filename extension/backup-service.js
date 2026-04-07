const BACKUP_KEY = "bookmark_backups_index";
const BACKUP_DATA_PREFIX = "backup_data_";
const MAX_BACKUPS = 20;

export async function createBackup(reason = "manual") {
  const tree = await chrome.bookmarks.getTree();
  const snapshot = JSON.stringify(tree);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await chrome.storage.local.set({
    [`${BACKUP_DATA_PREFIX}${id}`]: snapshot,
  });

  const { [BACKUP_KEY]: index = [] } = await chrome.storage.local.get(BACKUP_KEY);
  const entry = {
    id,
    createdAt: new Date().toISOString(),
    reason,
    size: snapshot.length,
  };

  index.unshift(entry);

  while (index.length > MAX_BACKUPS) {
    const old = index.pop();
    await chrome.storage.local.remove(`${BACKUP_DATA_PREFIX}${old.id}`);
  }

  await chrome.storage.local.set({ [BACKUP_KEY]: index });
  return entry;
}

export async function listBackups() {
  const { [BACKUP_KEY]: index = [] } = await chrome.storage.local.get(BACKUP_KEY);
  return index;
}

export async function restoreBackup(backupId) {
  const safetyBackup = await createBackup(`pre-rollback:${backupId}`);

  const key = `${BACKUP_DATA_PREFIX}${backupId}`;
  const result = await chrome.storage.local.get(key);
  const snapshot = result[key];

  if (!snapshot) {
    throw new Error("백업을 찾을 수 없습니다.");
  }

  const savedTree = JSON.parse(snapshot);
  await clearAllBookmarks();
  await recreateFromSnapshot(savedTree);

  return { safetyBackup };
}

async function clearAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();

  for (const root of tree[0].children) {
    const children = [...(root.children || [])].reverse();
    for (const child of children) {
      try {
        if (child.url) {
          await chrome.bookmarks.remove(child.id);
        } else {
          await chrome.bookmarks.removeTree(child.id);
        }
      } catch {
        // already removed
      }
    }
  }
}

async function recreateFromSnapshot(savedTree) {
  const roots = savedTree[0].children;
  const currentTree = await chrome.bookmarks.getTree();
  const currentRoots = currentTree[0].children;

  for (let i = 0; i < roots.length && i < currentRoots.length; i++) {
    await recreateChildren(currentRoots[i].id, roots[i].children || []);
  }
}

async function recreateChildren(parentId, children) {
  for (const child of children) {
    if (child.url) {
      await chrome.bookmarks.create({
        parentId,
        title: child.title,
        url: child.url,
      });
    } else {
      const folder = await chrome.bookmarks.create({
        parentId,
        title: child.title,
      });
      if (child.children?.length) {
        await recreateChildren(folder.id, child.children);
      }
    }
  }
}

export function downloadBackupAsFile(snapshotJson) {
  const blob = new Blob([snapshotJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bookmarks-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
