import { describe, expect, it } from "vitest";
import { getChangelog, parseChangelog } from "./changelog";

describe("parseChangelog", () => {
  it("Keep a Changelog 形式のマークダウンからバージョン・日付・コンテンツを抽出できる", () => {
    const md = `
# 更新履歴

## [1.2.0] - 2026-05-01
### 新機能
- 新機能を追加しました。

## [1.1.0] - 2026-04-15
### 修正
- 不具合を修正しました。
`;

    const releases = parseChangelog(md);
    expect(releases).toHaveLength(2);
    expect(releases[0]).toEqual({
      version: "1.2.0",
      date: "2026-05-01",
      content: "### 新機能\n- 新機能を追加しました。",
    });
    expect(releases[1]).toEqual({
      version: "1.1.0",
      date: "2026-04-15",
      content: "### 修正\n- 不具合を修正しました。",
    });
  });

  it("ヘッダーの表記揺れ（括弧なし、vプレフィックスなど）にも対応する", () => {
    const md = `
## v1.0.0 - 2026-01-01
初回リリース
## 0.9.0 (2025-12-15)
ベータリリース
`;
    const releases = parseChangelog(md);
    expect(releases).toHaveLength(2);
    expect(releases[0]?.version).toBe("1.0.0");
    expect(releases[0]?.date).toBe("2026-01-01");
    expect(releases[1]?.version).toBe("0.9.0");
    expect(releases[1]?.date).toBe("2025-12-15");
  });
});

describe("getChangelog", () => {
  it("実際の content/changelog.md を読み込める", () => {
    const releases = getChangelog();
    expect(releases.length).toBeGreaterThan(0);
    expect(releases[0]?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(releases[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(releases[0]?.content.length).toBeGreaterThan(0);
  });
});
