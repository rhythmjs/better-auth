import type { Auth } from "better-auth";
import { compose, decorate, derive, mount, Rhythm } from "@rhythmjs/rhythm";
import type { ExtensionMiddleware, Middleware } from "@rhythmjs/rhythm/types";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { fromFetch } from "@rhythmjs/router/fetch";
import { pathIs } from "@rhythmjs/router/path";
import { error } from "@rhythmjs/router/response";
export { cors, type CorsOptions } from "@rhythmjs/security/cors";

export interface BetterAuthOptions<TAuth extends Auth<any>> {
  auth: TAuth;
  path?: string | undefined;
}

export interface BetterAuthAsyncOptions<TAuth extends Auth<any>, TDeps extends object> {
  useFactory: (deps: RhythmHttpContext & TDeps) => TAuth | Promise<TAuth>;
  path?: string;
}

export interface AuthContext {
  auth: Auth<any>;
}

type Session<TAuth extends Auth<any>> = TAuth["$Infer"]["Session"];

export function authHandler<TAuth extends Auth<any>>({
  auth,
  path = auth.options.basePath ?? "/api/auth",
}: BetterAuthOptions<TAuth>) {
  return mount(
    fromFetch((request) => auth.handler(request)),
    pathIs(`${path}/**`),
  );
}

export const betterAuthModule = {
  forRoot<TAuth extends Auth<any>>(options: Pick<BetterAuthOptions<TAuth>, "auth">) {
    return new Rhythm({ name: "better-auth" }).register(decorate(() => ({ auth: options.auth })));
  },
  forRootAsync<TAuth extends Auth<any>, TDeps extends object = {}>(
    options: BetterAuthAsyncOptions<TAuth, TDeps>,
  ): ExtensionMiddleware<RhythmHttpContext & TDeps, { auth: TAuth }> {
    let pending: Promise<TAuth> | undefined;
    let handler: Middleware<RhythmHttpContext> | undefined;

    const resolve = (deps: RhythmHttpContext & TDeps): Promise<TAuth> => {
      if (!pending) {
        const created = Promise.resolve().then(() => options.useFactory(deps));
        created.catch(() => {
          if (pending === created) pending = undefined;
        });
        pending = created;
      }
      return pending;
    };

    const middleware = compose<RhythmHttpContext & TDeps & AuthContext>([
      derive(async (ctx: RhythmHttpContext & TDeps) => ({ auth: await resolve(ctx) })),
      async (ctx, next) => {
        handler ??= authHandler({ auth: ctx.auth, path: options.path });
        await handler(ctx, next);
      },
    ]);
    return middleware as unknown as ExtensionMiddleware<RhythmHttpContext & TDeps, { auth: TAuth }>;
  },
};

type BaseSession = Session<Auth<any>>;

export interface SessionContext {
  session: BaseSession["session"] | null;
  user: BaseSession["user"] | null;
}

async function lookup(ctx: RhythmHttpContext & AuthContext): Promise<SessionContext> {
  const result = await ctx.auth.api.getSession({ headers: ctx.request.headers });
  return { session: result?.session ?? null, user: result?.user ?? null };
}

export function withSession() {
  return derive(lookup);
}

export function requireSession() {
  const guard: Middleware<RhythmHttpContext & AuthContext> = async (ctx, next) => {
    const { session, user } = await lookup(ctx);
    if (!session || !user) {
      error(ctx, 401, "Unauthorized");
      return;
    }
    Object.assign(ctx, { session, user });
    await next();
  };
  return guard as ExtensionMiddleware<
    RhythmHttpContext & AuthContext,
    { session: NonNullable<SessionContext["session"]>; user: NonNullable<SessionContext["user"]> }
  >;
}
