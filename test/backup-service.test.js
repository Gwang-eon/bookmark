import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createCompressedBackup,
  detectChromeBookmarkFiles,
  listBackups,
  readBookmarksFile,
  restoreBackup,
  writeBookmarksFile,
} from "../src/backup-service.js";

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bookmark-organizer-"));
}

test("backup service creates gzip backups and restores them", async () => {
  const tempDir = await makeTempDir();
  const backupRootDir = path.join(tempDir, ".backup-store");
  const bookmarkPath = path.join(tempDir, "Bookmarks");
  const original = JSON.stringify({ roots: { bookmark_bar: { type: "folder", children: [] } } });

  await fs.writeFile(bookmarkPath, original, "utf8");

  const backup = await createCompressedBackup(bookmarkPath, {
    backupRootDir,
    reason: "pre-apply",
  });

  await writeBookmarksFile(bookmarkPath, JSON.stringify({ roots: { bookmark_bar: { type: "folder", children: [{ id: "1", type: "url", name: "A", url: "https://example.com" }] } } }));

  const restored = await restoreBackup(bookmarkPath, backup.id, { backupRootDir });
  const file = await readBookmarksFile(bookmarkPath);
  const backups = await listBackups(bookmarkPath, { backupRootDir });

  assert.equal(file.rawText, original);
  assert.equal(restored.backup.id, backup.id);
  assert.equal(backups.length, 2);
  assert.match(backups[0].reason, /pre-rollback/);
});

test("detectChromeBookmarkFiles finds default and profile bookmarks", async () => {
  const tempDir = await makeTempDir();
  const homeDirectory = path.join(tempDir, "home");
  const windowsUsersRoot = path.join(tempDir, "Users");
  const linuxUserData = path.join(homeDirectory, ".config", "google-chrome");
  const windowsUserData = path.join(windowsUsersRoot, "alice", "AppData", "Local", "Google", "Chrome", "User Data");

  await fs.mkdir(path.join(linuxUserData, "Default"), { recursive: true });
  await fs.mkdir(path.join(windowsUserData, "Profile 2"), { recursive: true });
  await fs.writeFile(path.join(linuxUserData, "Default", "Bookmarks"), '{"roots":{}}', "utf8");
  await fs.writeFile(path.join(windowsUserData, "Profile 2", "Bookmarks"), '{"roots":{}}', "utf8");

  const detected = await detectChromeBookmarkFiles({
    homeDirectory,
    windowsUsersRoot,
  });

  assert.deepEqual(detected, [
    path.join(linuxUserData, "Default", "Bookmarks"),
    path.join(windowsUserData, "Profile 2", "Bookmarks"),
  ]);
});
