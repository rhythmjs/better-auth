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
  logger: { disabled: true },
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

describe("betterAuthModule.forRootAsync", () => {
  test("builds auth from the context it is registered into, once, and mounts its handler", async () => {
    const database = new Database(":memory:");
    const created = betterAuth({
      database,
      baseURL: "http://localhost",
      secret: "test-secret-test-secret-test-secret-1234",
      logger: { disabled: true },
      emailAndPassword: { enabled: true },
    });
    await (await getMigrations(created.options)).runMigrations();
    let calls = 0;
    let received: unknown;
    const parent = new Rhythm<RhythmHttpContext, { database: Database }>();
    parent.context.database = database;
    const app = toFetchHandler(
      parent
        .register(
          betterAuthModule.forRootAsync({
            useFactory: ({ database }: RhythmHttpContext & { database: Database }) => {
              calls++;
              received = database;
              return created;
            },
          }),
          (m) => ({ auth: m.auth }),
        )
        .use(withSession())
        .use((ctx) => ctx.json({ hasAuth: typeof ctx.auth.handler, user: ctx.user })),
    );

    const res = await app(new Request("http://localhost/x"));
    await app(new Request("http://localhost/y"));
    const authRes = await app(new Request("http://localhost/api/auth/ok"));

    expect(await res.json()).toEqual({ hasAuth: "function", user: null });
    expect(authRes.status).toBe(200);
    expect(received).toBe(database);
    expect(calls).toBe(1);
  });

  test("supports an async factory and mounts at the auth's own basePath", async () => {
    const custom = betterAuth({
      database: new Database(":memory:"),
      baseURL: "http://localhost",
      basePath: "/custom",
      secret: "test-secret-test-secret-test-secret-1234",
      logger: { disabled: true },
    });
    await (await getMigrations(custom.options)).runMigrations();
    const app = toFetchHandler(
      new Rhythm<RhythmHttpContext>().register(betterAuthModule.forRootAsync({ useFactory: async () => custom })),
    );

    expect(await (await app(new Request("http://localhost/custom/ok"))).json()).toEqual({ ok: true });
    expect(await (await app(new Request("http://localhost/api/auth/ok"))).text()).toBe("");
  });

  test("a failing factory is retried on the next request", async () => {
    let calls = 0;
    const app = toFetchHandler(
      new Rhythm<RhythmHttpContext>().register(
        betterAuthModule.forRootAsync({
          useFactory: () => {
            if (++calls === 1) throw new Error("not ready");
            return auth;
          },
        }),
      ),
    );

    await expect(app(new Request("http://localhost/api/auth/ok"))).rejects.toThrow();
    expect((await app(new Request("http://localhost/api/auth/ok"))).status).toBe(200);
    expect(calls).toBe(2);
  });
});
