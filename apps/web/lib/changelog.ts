import changelogMarkdown from "../content/changelog.md";

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
 * ビルド時にバンドルされた content/changelog.md をパースした結果を返す。
 * Cloudflare Workers（workerd）環境では実行時にホスト側のファイルシステム（node:fs）へ
 * アクセスできないため、Markdown をモジュールとして静的にバンドルして参照する。
 */
export function getChangelog(): ChangelogRelease[] {
  return parseChangelog(changelogMarkdown);
}
