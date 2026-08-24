import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv, Bindings } from "../env";
import assetsRoute from "./assets";

function buildApp() {
  const app = new Hono<AppEnv>();
  app.route("/assets", assetsRoute);
  return app;
}

const ENV: Partial<Bindings> = {
  COOKIE_SECRET: "test-secret-please-change",
  CHAT_ACCESS_SECRET: "test-chat-secret",
};

describe("GET /assets/:folder/:filename", () => {
  it("オブジェクトが存在する場合は ETag と Cache-Control を付与して 200 を返す", async () => {
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
    expect(mockBucket.get).toHaveBeenCalledWith("generated/test.png");
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
  });

  it("If-None-Match が ETag と一致する場合は 304 Not Modified（bodyなし）を返す", async () => {
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
    const bodyText = await res.text();
    expect(bodyText).toBe("");
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
