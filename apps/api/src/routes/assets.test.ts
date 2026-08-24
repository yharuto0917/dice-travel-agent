import { Hono } from "hono";
import { cors } from "hono/cors";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv, Bindings } from "../env";
import { isAllowedOrigin } from "../lib/cors";
import { clientId } from "../middleware/client-id";
import assetsRoute, { matchesIfNoneMatch } from "./assets";

function buildApp() {
  const app = new Hono<AppEnv>({ strict: false });
  app.use(
    "*",
    cors({
      origin: (origin, c) => (isAllowedOrigin(origin, c.env) ? origin : undefined),
      credentials: true,
    }),
  );
  // index.ts と同様に assetsRoute を clientId より前にマウント
  app.route("/assets", assetsRoute);
  app.use("*", clientId);
  app.get("/me", (c) => c.json({ clientId: c.get("clientId") }));
  return app;
}

const ENV: Partial<Bindings> = {
  COOKIE_SECRET: "test-secret-please-change",
  CHAT_ACCESS_SECRET: "test-chat-secret",
};

describe("matchesIfNoneMatch unit", () => {
  it("完全一致、Weak ETag、ワイルドカード、リスト形式を正しく判定する", () => {
    expect(matchesIfNoneMatch('"etag-1"', '"etag-1"')).toBe(true);
    expect(matchesIfNoneMatch('W/"etag-1"', '"etag-1"')).toBe(true);
    expect(matchesIfNoneMatch('"etag-1"', 'W/"etag-1"')).toBe(true);
    expect(matchesIfNoneMatch('W/"etag-1"', 'W/"etag-1"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"etag-1"')).toBe(true);
    expect(matchesIfNoneMatch('"other", "etag-1"', '"etag-1"')).toBe(true);
    expect(matchesIfNoneMatch('"other", W/"etag-1"', '"etag-1"')).toBe(true);
    expect(matchesIfNoneMatch('"other", "another"', '"etag-1"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"etag-1"')).toBe(false);
    expect(matchesIfNoneMatch(null, '"etag-1"')).toBe(false);
  });
});

describe("GET /assets/:folder/:filename", () => {
  it("オブジェクトが存在する場合は ETag と Cache-Control を付与し Set-Cookie なしで 200 を返す", async () => {
    const fakeObject = {
      body: new Uint8Array([1, 2, 3, 4]).buffer,
      httpEtag: '"etag-12345"',
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", "image/png");
      },
    };

    const mockBucket = {
      get: vi.fn(async (key: string) => {
        if (key === "generated/test.png") return fakeObject;
        return null;
      }),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request("/assets/generated/test.png", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"etag-12345"');
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mockBucket.get).toHaveBeenCalledWith("generated/test.png");
  });

  it("clientId ミドルウェア以降の通常ルート (/me) では Set-Cookie が付与される", async () => {
    const env = { ...ENV } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request("/me", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).not.toBeNull();
  });

  it("すでに cache-control が設定されている場合は上書きしない", async () => {
    const fakeObject = {
      body: new Uint8Array([1, 2, 3, 4]).buffer,
      httpEtag: '"etag-custom"',
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", "image/png");
        headers.set("cache-control", "public, max-age=3600");
      },
    };

    const mockBucket = {
      get: vi.fn(async () => fakeObject),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request("/assets/generated/test.png", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("If-None-Match 完全一致時は 304 Not Modified（bodyなし、Content-Typeなし）を返す", async () => {
    const fakeObject = {
      body: new Uint8Array([1, 2, 3, 4]).buffer,
      httpEtag: '"etag-12345"',
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", "image/png");
      },
    };

    const mockBucket = {
      get: vi.fn(async () => fakeObject),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request(
      "/assets/generated/test.png",
      { headers: { "if-none-match": '"etag-12345"' } },
      env,
    );

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"etag-12345"');
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    const bodyText = await res.text();
    expect(bodyText).toBe("");
  });

  it("If-None-Match が Weak ETag (W/...) の場合も 304 を返す", async () => {
    const fakeObject = {
      body: new Uint8Array([1, 2, 3, 4]).buffer,
      httpEtag: '"etag-12345"',
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", "image/png");
      },
    };

    const mockBucket = {
      get: vi.fn(async () => fakeObject),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request(
      "/assets/generated/test.png",
      { headers: { "if-none-match": 'W/"etag-12345"' } },
      env,
    );

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"etag-12345"');
    expect(res.headers.get("content-type")).toBeNull();
  });

  it("If-None-Match が * (ワイルドカード) の場合も 304 を返す", async () => {
    const fakeObject = {
      body: new Uint8Array([1, 2, 3, 4]).buffer,
      httpEtag: '"etag-12345"',
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", "image/png");
      },
    };

    const mockBucket = {
      get: vi.fn(async () => fakeObject),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request(
      "/assets/generated/test.png",
      { headers: { "if-none-match": "*" } },
      env,
    );

    expect(res.status).toBe(304);
  });

  it("If-None-Match がカンマ区切りリスト（一部一致・Weak含む）の場合も 304 を返す", async () => {
    const fakeObject = {
      body: new Uint8Array([1, 2, 3, 4]).buffer,
      httpEtag: '"etag-12345"',
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", "image/png");
      },
    };

    const mockBucket = {
      get: vi.fn(async () => fakeObject),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request(
      "/assets/generated/test.png",
      { headers: { "if-none-match": '"other-etag", W/"etag-12345"' } },
      env,
    );

    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"etag-12345"');
    expect(res.headers.get("content-type")).toBeNull();
  });

  it("If-None-Match が ETag と一致しない場合は通常の 200 を返す", async () => {
    const fakeObject = {
      body: new Uint8Array([1, 2, 3, 4]).buffer,
      httpEtag: '"etag-12345"',
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", "image/png");
      },
    };

    const mockBucket = {
      get: vi.fn(async () => fakeObject),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request(
      "/assets/generated/test.png",
      { headers: { "if-none-match": '"other-etag"' } },
      env,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("オブジェクトが存在しない場合は 404 を返す", async () => {
    const mockBucket = {
      get: vi.fn(async () => null),
    };

    const env = { ...ENV, BUCKET: mockBucket } as unknown as Bindings;
    const app = buildApp();
    const res = await app.request("/assets/generated/notfound.png", {}, env);

    expect(res.status).toBe(404);
  });
});
