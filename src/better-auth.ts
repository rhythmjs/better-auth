import type { Auth } from "better-auth";
import { mount } from "@rhythmjs/http/mount";
import { derive, Rhythm } from "@rhythmjs/rhythm";
import type { DeriveMiddleware, Middleware } from "@rhythmjs/rhythm/types";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
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
}: BetterAuthOptions<TAuth>): Middleware<RhythmHttpContext> {
  return mount(`${path}/**`, (ctx) => auth.handler(ctx.request));
}

export const betterAuthModule = {
  forRoot<TAuth extends Auth<any>>(options: BetterAuthOptions<TAuth>) {
    const module = new Rhythm<RhythmHttpContext, { auth: TAuth }>({ type: "module", name: "better-auth" });
    module.context.auth = options.auth;
    return module.use(authHandler(options));
  },
  forRootAsync<TAuth extends Auth<any>, TDeps extends object = {}>(options: BetterAuthAsyncOptions<TAuth, TDeps>) {
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

    return new Rhythm<RhythmHttpContext & TDeps>({ type: "module", name: "better-auth" })
      .use(derive(async (ctx: RhythmHttpContext & TDeps) => ({ auth: await resolve(ctx) })))
      .use(async (ctx, next) => {
        handler ??= authHandler({ auth: ctx.auth, path: options.path });
        await handler(ctx, next);
      });
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
      ctx.error(401, "Unauthorized");
      return;
    }
    Object.assign(ctx, { session, user });
    await next();
  };
  return guard as DeriveMiddleware<
    RhythmHttpContext & AuthContext,
    { session: NonNullable<SessionContext["session"]>; user: NonNullable<SessionContext["user"]> }
  >;
}
