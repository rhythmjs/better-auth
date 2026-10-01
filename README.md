# @rhythmjs/better-auth

[Better Auth](https://better-auth.com) for Rhythm on Bun. Three plain pieces, each taking the `auth` instance you built:

```ts
import { betterAuthModule, requireSession } from "@rhythmjs/better-auth";

const app = new Rhythm<RhythmHttpContext>()
  .register(betterAuthModule.forRoot({ auth }), (m) => ({ auth: m.auth })) // you choose what to export
  .use(requireSession()) // reads ctx.auth: 401 without a session, else sets ctx.session and ctx.user
  .use((ctx) => ctx.json({ email: ctx.user.email }));
```

- `betterAuthModule.forRoot({ auth, path? })` mounts `auth.handler` (`path` defaults to `auth.options.basePath`, else `/api/auth`) and provides `auth`. Nothing reaches your context until you export it in the `.register()` callback (`m.auth`).
- `withSession()` is the soft version: same lookup, but it always continues and sets `ctx.session` and `ctx.user` to the session or `null`.
- `requireSession()` takes nothing and uses `ctx.auth`: it calls `auth.api.getSession`, answers 401 without a session, and otherwise sets `ctx.session` and `ctx.user`. Their types are Better Auth's base session and user; for plugin or custom fields call `ctx.auth.api.getSession` yourself, which is fully typed.
- `authHandler({ auth, path? })` is the bare mounting middleware, for use without the module.
- `cors` and `CorsOptions` are re-exported unchanged from `@rhythmjs/security/cors`, so there is one import. Configure it yourself; for cookie sessions across origins that means `cors({ origin, credentials: true })`. Put it before the module so preflight requests are answered first.

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
