import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { SignupForm } from "@/components/forms/signup-form";
import { getCurrentUser } from "@/actions/auth";

export const metadata = {
  title: "Sign up · Skello",
};

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 md:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <div className="mb-8 space-y-1.5">
            <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight">
              Create your workspace
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Spin up Skello for your team in under a minute.
            </p>
          </div>
          <SignupForm />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          By signing up you agree to our Terms and Privacy Policy.
        </p>
      </div>
      <aside className="relative hidden overflow-hidden border-l border-border/60 bg-muted/40 lg:block">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(0,0,0,0.06),transparent_60%)] dark:bg-[radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.06),transparent_60%)]"
        />
        <div className="relative flex h-full flex-col justify-between p-12">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Built for B2B
          </span>
          <div className="space-y-3">
            <h2 className="max-w-md font-heading text-3xl font-semibold leading-tight tracking-tight">
              Set up in one minute. <br />
              Close in one tab.
            </h2>
            <ul className="max-w-md space-y-1.5 text-sm leading-relaxed text-muted-foreground">
              <li>· Multi-tenant by default</li>
              <li>· WhatsApp + voice in the same workflow</li>
              <li>· Reminders that actually fire</li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
