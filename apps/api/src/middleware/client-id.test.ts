import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv, Bindings } from "../env";
import { CLIENT_ID_COOKIE, clientId } from "./client-id";

const ENV = { COOKIE_SECRET: "test-secret-please-change" } as Bindings;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", clientId);
  app.get("/me", (c) => c.json({ clientId: c.get("clientId") }));
  return app;
}

/** Set-Cookie ヘッダから `cid=...` の組（値＋署名）だけを取り出す。 */
function extractCookiePair(setCookie: string | null): string {
  if (!setCookie) throw new Error("Set-Cookie header is missing");
  const [pair] = setCookie.split(";");
  if (!pair) throw new Error("Set-Cookie header is malformed");
  return pair;
}

describe("clientId middleware", () => {
  it("Cookie が無ければ匿名IDを発行し、属性付きで Set-Cookie する", async () => {
    const app = buildApp();
    const res = await app.request("/me", {}, ENV);
    const body = (await res.json()) as { clientId: string };

    expect(body.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);

    const setCookie = res.headers.get("set-cookie")?.toLowerCase() ?? "";
    expect(setCookie).toContain(`${CLIENT_ID_COOKIE}=`);
    expect(setCookie).toContain("httponly");
    expect(setCookie).toContain("secure");
    expect(setCookie).toContain("samesite=lax");
    expect(setCookie).toContain("path=/");
  });

  it("正当な Cookie を送れば同一クライアントとして識別し、再発行しない", async () => {
    const app = buildApp();
    const first = await app.request("/me", {}, ENV);
    const firstId = ((await first.json()) as { clientId: string }).clientId;
    const cookie = extractCookiePair(first.headers.get("set-cookie"));

    const second = await app.request("/me", { headers: { Cookie: cookie } }, ENV);
    const secondId = ((await second.json()) as { clientId: string }).clientId;

    expect(secondId).toBe(firstId);
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("署名が不正（改竄）な Cookie は無視して新しいIDを発行する", async () => {
    const app = buildApp();
    const first = await app.request("/me", {}, ENV);
    const firstId = ((await first.json()) as { clientId: string }).clientId;

    const tampered = await app.request(
      "/me",
      { headers: { Cookie: `${CLIENT_ID_COOKIE}=tampered.invalidsignature` } },
      ENV,
    );
    const tamperedId = ((await tampered.json()) as { clientId: string }).clientId;

    expect(tamperedId).not.toBe(firstId);
    expect(tampered.headers.get("set-cookie")).toContain(`${CLIENT_ID_COOKIE}=`);
  });
});
