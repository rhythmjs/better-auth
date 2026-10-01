import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import { betterAuthModule, requireSession, withSession, cors, authHandler } from "./better-auth";

const auth = betterAuth({
  database: new Database(":memory:"),
  baseURL: "http://localhost",
  secret: "test-secret-test-secret-test-secret-1234",
  emailAndPassword: { enabled: true },
});

const authApp = toFetchHandler(new Rhythm<RhythmHttpContext>().register(betterAuthModule.forRoot({ auth })));

const handler = toFetchHandler(
  new Rhythm<RhythmHttpContext>()
    .register(betterAuthModule.forRoot({ auth }), (m) => ({ auth: m.auth }))
    .use(requireSession())
    .use((ctx) => ctx.json({ email: ctx.user.email })),
);

beforeAll(async () => {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
});

describe("betterAuthModule", () => {
  test("rejects anonymous requests with 401", async () => {
    expect((await handler(new Request("http://localhost/me"))).status).toBe(401);
  });

  test("mounts auth.handler and derives the session from its cookie", async () => {
    const signUp = await authApp(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ email: "ada@example.com", password: "password1234", name: "Ada" }),
      }),
    );
    expect(signUp.status).toBe(200);

    const cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const me = await handler(new Request("http://localhost/me", { headers: { cookie } }));

    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ email: "ada@example.com" });
  });

  test("authHandler works as a plain middleware, without the module", async () => {
    const app = toFetchHandler(
      new Rhythm<RhythmHttpContext>().use(authHandler({ auth })).use((ctx) => ctx.json({ fellThrough: true })),
    );

    expect((await app(new Request("http://localhost/api/auth/ok"))).status).toBe(200);
    expect(await (await app(new Request("http://localhost/other"))).json()).toEqual({ fellThrough: true });
  });

  test("cors allows the given origin with credentials, and answers preflight", async () => {
    const app = toFetchHandler(
      new Rhythm<RhythmHttpContext>()
        .use(cors({ origin: "http://app.test", credentials: true, allowHeaders: ["Content-Type", "Authorization"] }))
        .register(betterAuthModule.forRoot({ auth })),
    );

    const res = await app(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "OPTIONS",
        headers: { origin: "http://app.test" },
      }),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://app.test");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type,Authorization");
  });

  test("withSession sets null session and user instead of answering 401", async () => {
    const app = toFetchHandler(
      new Rhythm<RhythmHttpContext>()
        .register(betterAuthModule.forRoot({ auth }), (m) => ({ auth: m.auth }))
        .use(withSession())
        .use((ctx) => ctx.json({ user: ctx.user, session: ctx.session })),
    );

    const res = await app(new Request("http://localhost/x"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null, session: null });
  });
});
