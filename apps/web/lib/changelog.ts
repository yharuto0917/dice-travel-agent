import fs from "node:fs";
import path from "node:path";

export interface ChangelogRelease {
  version: string;
  date: string;
  content: string;
}

/**
 * Keep a Changelog 形式の Markdown テキストをパースし、
 * バージョンごとのリリース情報配列に分解する。
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  // ## [version] - YYYY-MM-DD または ## version - YYYY-MM-DD
  const headingRegex =
    /^##\s*\[?v?([0-9]+\.[0-9]+\.[0-9]+[^\]\s]*)\]?(?:\s*[-–—]\s*|\s*\()([0-9]{4}-[0-9]{2}-[0-9]{2})\)?/gm;

  const matches: { version: string; date: string; index: number; length: number }[] = [];
  let match: RegExpExecArray | null;

  while (true) {
    match = headingRegex.exec(markdown);
    if (!match) break;
    matches.push({
      version: match[1] ?? "",
      date: match[2] ?? "",
      index: match.index,
      length: match[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    if (!current) continue;
    const next = matches[i + 1];
    const startIndex = current.index + current.length;
    const endIndex = next ? next.index : markdown.length;
    const content = markdown.slice(startIndex, endIndex).trim();

    releases.push({
      version: current.version,
      date: current.date,
      content,
    });
  }

  return releases;
}

/**
 * content/changelog.md のパスを解決する。
 * Turbopack の静的トレースを阻害しないよう、apps/web ルートおよびモノレポルートから探索する。
 */
function resolveChangelogPath(): string | null {
  const defaultPath = path.join(process.cwd(), "content", "changelog.md");
  if (fs.existsSync(defaultPath)) return defaultPath;

  const monorepoPath = path.join(process.cwd(), "apps", "web", "content", "changelog.md");
  if (fs.existsSync(monorepoPath)) return monorepoPath;

  return null;
}

/**
 * content/changelog.md を読み込んでパースした結果を返す。
 * ビルド時または Server Component で実行される。
 */
export function getChangelog(): ChangelogRelease[] {
  const filePath = resolveChangelogPath();
  if (!filePath) {
    console.error("[getChangelog] changelog.md not found in any candidate paths");
    return [];
  }
  try {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    return parseChangelog(fileContent);
  } catch (error) {
    console.error("[getChangelog] Failed to read changelog file:", error);
    return [];
  }
}
