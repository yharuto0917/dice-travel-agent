import { Hono } from "hono";
import type { AppEnv } from "../env";

const assetsRoute = new Hono<AppEnv>();

/**
 * RFC 9110 §13.1.2 に基づく If-None-Match の判定。
 * - `*` は既存リソースに一致
 * - `W/` 接頭辞（Weak ETag）および前後の二重引用符を除去して弱比較
 * - カンマ区切りのリスト形式に対応
 */
export function matchesIfNoneMatch(
  ifNoneMatchHeader: string | null | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatchHeader) return false;
  const trimmed = ifNoneMatchHeader.trim();
  if (trimmed === "*") return true;

  const normalize = (val: string) => val.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const target = normalize(etag);
  const candidates = trimmed.split(",").map(normalize);

  return candidates.includes(target);
}

/** R2 からアセットを提供するエンドポイント（#18） */
assetsRoute.get("/:folder/:filename", async (c) => {
  const folder = c.req.param("folder");
  const filename = c.req.param("filename");
  const key = `${folder}/${filename}`;
  const object = await c.env.BUCKET.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);

  if (!headers.has("cache-control")) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }

  const ifNoneMatch = c.req.header("if-none-match");
  if (matchesIfNoneMatch(ifNoneMatch, object.httpEtag)) {
    const notModifiedHeaders = new Headers(headers);
    // RFC 9110 §15.4.5: 304 にはエンティティヘッダ（Content-Type 等）を含めない
    notModifiedHeaders.delete("content-type");
    notModifiedHeaders.delete("content-length");
    return new Response(null, { status: 304, headers: notModifiedHeaders });
  }

  return new Response(object.body, { headers });
});

export default assetsRoute;
