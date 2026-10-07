# @rhythmjs/better-auth

[Better Auth](https://better-auth.com) for Rhythm on Bun. It sits between your `auth` instance and your routes: a module
holds `auth` on the startup context, `authHandler` mounts Better Auth's HTTP routes, and `withSession` / `requireSession`
put `ctx.session` and `ctx.user` on the request context. You create and own the `auth` instance (and its database).

## Installation

```sh
bun add @rhythmjs/better-auth @rhythmjs/rhythm @rhythmjs/router better-auth
```

Peer dependencies: `@rhythmjs/rhythm >=0.0.20`, `@rhythmjs/router >=0.0.20`, `better-auth` (any version; developed
against 1.7). Requires Bun >=1.2. `@rhythmjs/http` and `@rhythmjs/security` are regular dependencies and install
automatically.

## Using it with Rhythm

```ts
import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { include, Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import { authHandler, betterAuthModule, requireSession } from "@rhythmjs/better-auth";

const auth = betterAuth({
  database: new Database("auth.db"),
  emailAndPassword: { enabled: true },
});

const app = new Rhythm<{}, RhythmHttpContext>()
  // startup context: put `auth` on ctx (you choose what to export from the module)
  .register(include(betterAuthModule.forRoot({ auth }), (m) => ({ auth: m.auth })))
  // answers /api/auth/** (Better Auth's routes); everything else continues
  .use(authHandler({ auth }))
  // reads ctx.auth: 401 without a session, else sets ctx.session and ctx.user
  .use(requireSession())
  .use((ctx) => ctx.json({ email: ctx.user.email }));

Bun.serve({ fetch: toFetchHandler(app) });
```

Order matters:

1. `.register(include(betterAuthModule.forRoot({ auth }), ...))` first, so `ctx.auth` exists for later middleware.
2. `cors(...)` (if you need it), before the handler so preflight requests are answered first.
3. `authHandler(...)`, before any session guard, so sign-in/sign-up routes stay reachable without a session.
4. `withSession()` or `requireSession()`, then your own routers, e.g. `.use(mount(router))` for an `@rhythmjs/router`
   router. Handlers after the guard see `ctx.auth`, `ctx.session` and `ctx.user`.

What ends up on `ctx`:

| Field         | Set by                                     | Type                                                 |
| ------------- | ------------------------------------------ | ---------------------------------------------------- |
| `ctx.auth`    | `forRoot` via `include`, or `forRootAsync` | your `auth` instance                                 |
| `ctx.session` | `withSession` / `requireSession`           | Better Auth base session (`null` with `withSession`) |
| `ctx.user`    | `withSession` / `requireSession`           | Better Auth base user (`null` with `withSession`)    |

Under `requireSession()` the types are non-null; under `withSession()` they are `| null`.

## API

### `authHandler({ auth, path? })`

Returns a mountable pipeline that forwards requests under `${path}/**` to `auth.handler`. `path` defaults to
`auth.options.basePath`, else `/api/auth`. Requests outside that path continue down the chain. Use it with `.use(...)`.

### `betterAuthModule.forRoot({ auth })`

Returns a `Rhythm` module (named `"better-auth"`) whose startup context holds `auth`. Nothing reaches your context
until you pull it in: `include(betterAuthModule.forRoot({ auth }), (m) => ({ auth: m.auth }))`.

### `betterAuthModule.forRootAsync({ useFactory, path? })`

For an `auth` that needs things the app provides (a database, a mailer). It is a single middleware added with
`.use()`: it derives `auth` onto the request context and mounts `auth.handler` like `authHandler`. `useFactory`
receives the request context (including your startup fields), may be async, and runs once on the first request. If it
throws or rejects, the failure surfaces on that request and the factory is retried on the next one.

```ts
import { decorate, Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { betterAuthModule, withSession } from "@rhythmjs/better-auth";

const app = new Rhythm<{}, RhythmHttpContext>()
  .register(decorate(() => ({ database: openDatabase() })))
  .use(
    betterAuthModule.forRootAsync({
      useFactory: ({ database }: RhythmHttpContext & { database: Database }) => createAuth(database),
    }),
  )
  .use(withSession())
  .use((ctx) => ctx.json({ user: ctx.user }));
```

### `withSession()`

Soft lookup: calls `ctx.auth.api.getSession` with the request headers, always continues, and sets `ctx.session` and
`ctx.user` to the session/user or `null`. Requires `ctx.auth`.

### `requireSession()`

Same lookup, but answers `401 Unauthorized` when there is no session; otherwise sets `ctx.session` and `ctx.user` and
continues. Requires `ctx.auth`.

### `cors`, `CorsOptions`

Re-exported unchanged from `@rhythmjs/security/cors`, so you need no separate `@rhythmjs/security` install. For
cookie sessions across origins use `cors({ origin, credentials: true })`.

### Types

`BetterAuthOptions`, `BetterAuthAsyncOptions`, `AuthContext` (`{ auth }`) and `SessionContext` (`{ session, user }`).

## Notes and gotchas

- `ctx.session` / `ctx.user` are typed as Better Auth's base session and user. For plugin or custom fields call
  `ctx.auth.api.getSession({ headers: ctx.request.headers })` yourself; that is fully typed.
- The package never touches your database. You create it, run migrations (`getMigrations(auth.options)` from
  `better-auth/db/migration`), and close it on shutdown.
- With `forRootAsync`, `path` defaults from the resolved `auth`'s `basePath`, and the handler is built once.

## Testing your app

The app is a plain fetch handler, so you can call it without starting a server:

```ts
import { toFetchHandler } from "@rhythmjs/router/fetch";

const handler = toFetchHandler(app);
const res = await handler(new Request("http://localhost/me"));
expect(res.status).toBe(401);
```

To test authenticated routes, sign up through `/api/auth/sign-up/email` (send an `origin` header), collect the
`Set-Cookie` values from the response (`res.headers.getSetCookie()`), and send them back as the `cookie` header.
