import { createFileRoute } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 text-ink">
      <div className="w-full max-w-sm space-y-4">
        <p className="font-display text-3xl font-medium tracking-tight">格價簿</p>
        <p className="text-sm text-muted">登入後心願清單同低價提醒會留喺你自己個帳號。</p>
        {authEnabled ? (
          GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              onClick={() => signIn(provider.providerId, { callbackURL: "/" })}
              className="min-h-11 w-full rounded-xl border border-line bg-card px-4 text-sm font-medium hover:border-ink"
            >
              Continue with {provider.label}
            </button>
          ))
        ) : (
          <p className="text-sm text-muted">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
