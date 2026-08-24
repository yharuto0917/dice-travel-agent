import { Hono } from "hono";
import type { AppEnv } from "../env";

const assetsRoute = new Hono<AppEnv>();

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
  if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
});

export default assetsRoute;
