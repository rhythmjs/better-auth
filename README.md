# @rhythmjs/better-auth

[Better Auth](https://better-auth.com) for Rhythm on Bun. The module mounts the handler, and two middlewares read the session. You build the `auth` instance.

## Install

```sh
bun add better-auth @rhythmjs/better-auth
```

`@rhythmjs/http` and `@rhythmjs/security` come with the package, so there is nothing else to install. `@rhythmjs/rhythm` and `@rhythmjs/router` are peers: use the copy your app already has.

## Usage

```ts
import { betterAuthModule, requireSession } from "@rhythmjs/better-auth";

const app = new Rhythm<RhythmHttpContext>()
  .register(betterAuthModule.forRoot({ auth }), (m) => ({ auth: m.auth })) // you choose what to export
  .use(requireSession()) // reads ctx.auth: 401 without a session, else sets ctx.session and ctx.user
  .use((ctx) => ctx.json({ email: ctx.user.email }));
```

- `betterAuthModule.forRoot({ auth, path? })` mounts `auth.handler` (`path` defaults to `auth.options.basePath`, else `/api/auth`) and provides `auth`. Nothing reaches your context until you export it in the `.register()` callback (`m.auth`).
- `betterAuthModule.forRootAsync({ useFactory, path? })` builds `auth` from the context it is registered into, for an `auth` that needs things the app provides (a database, a mailer). `useFactory` receives that context, may be async, runs once on the first request, and is retried on the next request if it throws. It provides `auth` and mounts `auth.handler` exactly like `forRoot`:

  ```ts
  new Rhythm<RhythmHttpContext>()
    .register(databaseModule.forRoot(), (m) => ({ db: m.db }))
    .register(mailerModule.forRoot(), (m) => ({ mailerService: m.mailerService }))
    .register(
      betterAuthModule.forRootAsync({
        useFactory: ({ db, mailerService }: RhythmHttpContext & { db: Database; mailerService: MailerService }) =>
          createAuth(db, mailerService),
      }),
      (m) => ({ auth: m.auth }),
    );
  ```

- `withSession()` is the soft version: same lookup, but it always continues and sets `ctx.session` and `ctx.user` to the session or `null`.
- `requireSession()` takes nothing and uses `ctx.auth`: it calls `auth.api.getSession`, answers 401 without a session, and otherwise sets `ctx.session` and `ctx.user`. Their types are Better Auth's base session and user; for plugin or custom fields call `ctx.auth.api.getSession` yourself, which is fully typed.
- `authHandler({ auth, path? })` is the bare mounting middleware, for use without the module.
- `cors` and `CorsOptions` are re-exported unchanged from `@rhythmjs/security/cors`, so you import it from here and need no separate `@rhythmjs/security`. Configure it yourself; for cookie sessions across origins that means `cors({ origin, credentials: true })`. Put it before the module so preflight requests are answered first.

## Database

The package never touches it. You create the database and the `auth` instance, and you close the database:

```ts
const database = new Database("auth.db");
export const auth = betterAuth({ database, emailAndPassword: { enabled: true } });

new Rhythm<RhythmHttpContext>().provide(
  () => ({}),
  () => database.close(),
);
```

Migrations: `getMigrations(auth.options)`.
