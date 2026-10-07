# @rhythmjs/better-auth

[Better Auth](https://better-auth.com) for Rhythm on Bun. A module holds `auth`, a middleware mounts the handler, and two more read the session. You build the `auth` instance.

## Install

```sh
bun add better-auth @rhythmjs/better-auth
```

`@rhythmjs/http` and `@rhythmjs/security` come with the package, so there is nothing else to install. `@rhythmjs/rhythm` and `@rhythmjs/router` are peers: use the copy your app already has.

## Usage

```ts
import { decorate, include, Rhythm } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { authHandler, betterAuthModule, requireSession } from "@rhythmjs/better-auth";

const app = new Rhythm<{}, RhythmHttpContext>()
  .register(include(betterAuthModule.forRoot({ auth }), (m) => ({ auth: m.auth }))) // you choose what to export
  .use(authHandler({ auth })) // answers the Better Auth routes
  .use(requireSession()) // reads ctx.auth: 401 without a session, else sets ctx.session and ctx.user
  .use((ctx) => ctx.json({ email: ctx.user.email }));
```

- `betterAuthModule.forRoot({ auth })` is a `Rhythm` module that holds `auth` on its startup context. Nothing reaches your context until you pull it in with `include(module, (m) => ({ auth: m.auth }))`.
- `authHandler({ auth, path? })` is the middleware that mounts `auth.handler` (`path` defaults to `auth.options.basePath`, else `/api/auth`); requests outside that path continue down the chain.
- `betterAuthModule.forRootAsync({ useFactory, path? })` is for an `auth` that needs things the app provides (a database, a mailer). It is one middleware, added with `.use()`: it derives `auth` onto the request context and mounts `auth.handler` like `authHandler`. `useFactory` receives the request context (which includes your startup fields), may be async, runs once on the first request, and is retried on the next request if it throws:

  ```ts
  new Rhythm<{}, RhythmHttpContext>()
    .register(decorate(() => ({ db: openDatabase() })))
    .register(decorate(() => ({ mailerService: createMailer() })))
    .use(
      betterAuthModule.forRootAsync({
        useFactory: ({ db, mailerService }: RhythmHttpContext & { db: Database; mailerService: MailerService }) =>
          createAuth(db, mailerService),
      }),
    );
  ```

- `withSession()` is the soft version: same lookup, but it always continues and sets `ctx.session` and `ctx.user` to the session or `null`.
- `requireSession()` takes nothing and uses `ctx.auth`: it calls `auth.api.getSession`, answers 401 without a session, and otherwise sets `ctx.session` and `ctx.user`. Their types are Better Auth's base session and user; for plugin or custom fields call `ctx.auth.api.getSession` yourself, which is fully typed.
- `cors` and `CorsOptions` are re-exported unchanged from `@rhythmjs/security/cors`, so you import it from here and need no separate `@rhythmjs/security`. Configure it yourself; for cookie sessions across origins that means `cors({ origin, credentials: true })`. Put it before the handler so preflight requests are answered first.

## Database

The package never touches it. You create the database and the `auth` instance, and you close the database:

```ts
const database = new Database("auth.db");
export const auth = betterAuth({ database, emailAndPassword: { enabled: true } });

process.on("SIGTERM", () => database.close());
```

Migrations: `getMigrations(auth.options)`.
