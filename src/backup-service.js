import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function getBackupRoot(backupRootDir) {
  return backupRootDir ?? path.join(os.homedir(), ".chrome-bookmark-organizer", "backups");
}

function getIndexFilePath(backupRootDir) {
  return path.join(getBackupRoot(backupRootDir), "index.json");
}

async function ensureBackupStore(backupRootDir) {
  const backupRoot = getBackupRoot(backupRootDir);
  await fs.mkdir(backupRoot, { recursive: true });

  try {
    await fs.access(getIndexFilePath(backupRootDir));
  } catch {
    await fs.writeFile(getIndexFilePath(backupRootDir), "[]", "utf8");
  }
}

async function readBackupIndex(backupRootDir) {
  await ensureBackupStore(backupRootDir);
  const content = await fs.readFile(getIndexFilePath(backupRootDir), "utf8");
  return JSON.parse(content);
}

async function writeBackupIndex(entries, backupRootDir) {
  await ensureBackupStore(backupRootDir);
  await fs.writeFile(getIndexFilePath(backupRootDir), JSON.stringify(entries, null, 2), "utf8");
}

export function resolveInputPath(filePath) {
  return filePath
    .replace(/^~\//, process.env.HOME ? `${process.env.HOME}/` : "~/")
    .replace(/\$([A-Z_][A-Z0-9_]*)/gi, (_, name) => process.env[name] ?? `$${name}`)
    .replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}

export async function readBookmarksFile(filePath) {
  const resolvedPath = resolveInputPath(filePath);
  const content = await fs.readFile(resolvedPath, "utf8");
  if (!content.includes('"roots"')) {
    throw new Error("선택한 파일이 크롬 북마크 파일처럼 보이지 않습니다.");
  }
  return {
    resolvedPath,
    rawText: content,
  };
}

export async function writeBookmarksFile(filePath, rawText) {
  const resolvedPath = resolveInputPath(filePath);
  const directory = path.dirname(resolvedPath);
  const tempPath = path.join(directory, `.${path.basename(resolvedPath)}.bookmark-organizer.tmp`);

  await fs.writeFile(tempPath, rawText, "utf8");
  await fs.rename(tempPath, resolvedPath);

  return resolvedPath;
}

export function getBackupStorePath(backupRootDir) {
  return getBackupRoot(backupRootDir);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

async function findBookmarkFilesInUserDataDir(userDataDir) {
  if (!(await pathExists(userDataDir))) {
    return [];
  }

  const entries = await fs.readdir(userDataDir, { withFileTypes: true });
  const profileDirs = entries
    .filter((entry) => entry.isDirectory() && (entry.name === "Default" || /^Profile \d+$/i.test(entry.name)))
    .map((entry) => entry.name)
    .sort((left, right) => {
      if (left === "Default") {
        return -1;
      }
      if (right === "Default") {
        return 1;
      }
      return left.localeCompare(right, "en");
    });

  const found = [];
  for (const profileDir of profileDirs) {
    const bookmarkPath = path.join(userDataDir, profileDir, "Bookmarks");
    if (await pathExists(bookmarkPath)) {
      found.push(bookmarkPath);
    }
  }

  return found;
}

export async function detectChromeBookmarkFiles(options = {}) {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const windowsUsersRoot = options.windowsUsersRoot ?? "/mnt/c/Users";
  const explicitWindowsLocalAppData = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data")
    : "";

  const userDataDirs = uniquePaths([
    path.join(homeDirectory, ".config", "google-chrome"),
    path.join(homeDirectory, ".config", "chromium"),
    path.join(homeDirectory, "Library", "Application Support", "Google", "Chrome"),
    explicitWindowsLocalAppData,
  ]);

  if (await pathExists(windowsUsersRoot)) {
    const windowsUsers = await fs.readdir(windowsUsersRoot, { withFileTypes: true });
    for (const entry of windowsUsers) {
      if (!entry.isDirectory()) {
        continue;
      }

      userDataDirs.push(
        path.join(windowsUsersRoot, entry.name, "AppData", "Local", "Google", "Chrome", "User Data"),
      );
    }
  }

  const detected = [];
  for (const userDataDir of uniquePaths(userDataDirs)) {
    const files = await findBookmarkFilesInUserDataDir(userDataDir);
    detected.push(...files);
  }

  return uniquePaths(detected);
}

export async function listBackups(filePath, options = {}) {
  const resolvedPath = resolveInputPath(filePath);
  const entries = await readBackupIndex(options.backupRootDir);

  return entries
    .filter((entry) => entry.targetPath === resolvedPath)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createCompressedBackup(filePath, options = {}) {
  const resolvedPath = resolveInputPath(filePath);
  const sourceText = options.rawText ?? (await fs.readFile(resolvedPath, "utf8"));
  const compressed = await gzipAsync(Buffer.from(sourceText, "utf8"));
  const backupRoot = getBackupRoot(options.backupRootDir);
  const targetKey = createHash("sha1").update(resolvedPath).digest("hex").slice(0, 16);
  const backupId = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const backupDir = path.join(backupRoot, targetKey);
  const backupFilePath = path.join(backupDir, `${backupId}.json.gz`);

  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(backupFilePath, compressed);

  const metadata = {
    id: backupId,
    targetPath: resolvedPath,
    backupFilePath,
    createdAt: new Date().toISOString(),
    reason: options.reason ?? "manual",
    originalSize: Buffer.byteLength(sourceText),
    compressedSize: compressed.length,
  };

  const entries = await readBackupIndex(options.backupRootDir);
  entries.unshift(metadata);
  await writeBackupIndex(entries, options.backupRootDir);

  return metadata;
}

export async function restoreBackup(filePath, backupId, options = {}) {
  const resolvedPath = resolveInputPath(filePath);
  const entries = await readBackupIndex(options.backupRootDir);
  const backup = entries.find((entry) => entry.id === backupId && entry.targetPath === resolvedPath);

  if (!backup) {
    throw new Error("선택한 백업을 찾을 수 없습니다.");
  }

  const currentText = await fs.readFile(resolvedPath, "utf8");
  const safetyBackup = await createCompressedBackup(resolvedPath, {
    backupRootDir: options.backupRootDir,
    rawText: currentText,
    reason: `pre-rollback:${backupId}`,
  });

  const compressed = await fs.readFile(backup.backupFilePath);
  const restoredText = (await gunzipAsync(compressed)).toString("utf8");
  await writeBookmarksFile(resolvedPath, restoredText);

  return {
    backup,
    safetyBackup,
    rawText: restoredText,
    resolvedPath,
  };
}
