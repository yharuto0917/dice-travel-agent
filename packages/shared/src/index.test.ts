import { describe, expect, it } from "vitest";
import { UserSchema } from "./index";

describe("UserSchema", () => {
  it("正しい形のユーザーはパースできる", () => {
    expect(UserSchema.parse({ id: "u_1", name: "haruto" })).toEqual({
      id: "u_1",
      name: "haruto",
    });
  });

  it("型が不正なユーザーは例外を投げる", () => {
    expect(() => UserSchema.parse({ id: 1, name: "haruto" })).toThrow();
  });
});
