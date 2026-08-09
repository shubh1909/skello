"use client";

import { useTransition } from "react";
import Link from "next/link";
import {
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SettingsIcon,
  ShieldIcon,
  SunIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";

import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";
import { isTheme } from "@/lib/theme";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

function initials(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

export function UserMenu({
  email,
  isAdmin = false,
}: {
  email: string;
  isAdmin?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { theme, setTheme } = useTheme();

  function onLogout() {
    startTransition(async () => {
      const result = await logout();
      if (!result.success) toast.error(result.error);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Account"
          />
        }
      >
        <span className="grid size-7 place-items-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
          {initials(email)}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Signed in as</span>
            <span className="truncate text-sm text-foreground">{email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <UserIcon /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <SettingsIcon /> Workspace settings
        </DropdownMenuItem>

        {/* Until now there was no `setTheme` call anywhere in the app, so the
            entire dark palette was unreachable by deliberate user action —
            only by changing the OS and only if the stored preference happened
            to be "system", which is not the default. */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(next) => {
            // The menu hands back a plain string; `isTheme` is the same guard
            // the provider uses when reading localStorage.
            if (isTheme(next)) setTheme(next);
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              <option.icon /> {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {isAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/admin" />}>
              <ShieldIcon /> Admin console
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onClick={onLogout}
        >
          <LogOutIcon /> {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
