import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { LoginForm } from "@/components/forms/login-form";
import { getCurrentUser } from "@/actions/auth";
import { getIsAdmin } from "@/lib/auth/admin";

export const metadata = {
  title: "Log in · Skelo",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    const isAdmin = await getIsAdmin();
    redirect(isAdmin ? "/admin" : "/dashboard");
  }

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 md:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <div className="mb-8 space-y-1.5">
            <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight">
              Welcome back
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Sign in to your Skelo workspace.
            </p>
          </div>
          <LoginForm />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link
              href="/signup"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Create one
            </Link>
          </p>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Skelo
        </p>
      </div>
      <AuthAside
        eyebrow="Trusted by modern revenue teams"
        title="One workspace for every conversation."
        body="Inbound calls, WhatsApp follow-ups, and pipeline reminders — unified in a calm, fast interface."
      />
    </div>
  );
}

function AuthAside({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <aside className="relative hidden overflow-hidden border-l border-border/60 bg-muted/40 lg:block">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(0,0,0,0.06),transparent_60%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.06),transparent_60%)]"
      />
      <div className="relative flex h-full flex-col justify-between p-12">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {eyebrow}
        </span>
        <div className="space-y-3">
          <h2 className="max-w-md font-heading text-3xl font-semibold leading-tight tracking-tight">
            {title}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>
      </div>
    </aside>
  );
}
