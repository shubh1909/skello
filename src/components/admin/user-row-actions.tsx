"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, ShieldIcon, ShieldOffIcon } from "lucide-react";
import { toast } from "sonner";

import { setUserAdmin } from "@/actions/admin/users";
import { Button } from "@/components/ui/button";

interface Props {
  userId: string;
  isAdmin: boolean;
  isSelf: boolean;
}

export function UserRowActions({ userId, isAdmin, isSelf }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function onToggle() {
    const next = !isAdmin;
    const label = next ? "Promote to admin?" : "Remove admin rights?";
    if (!confirm(label)) return;
    startTransition(async () => {
      const result = await setUserAdmin({ user_id: userId, is_admin: next });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? "User promoted to admin" : "Admin rights removed");
      router.refresh();
    });
  }

  if (isSelf && isAdmin) {
    return (
      <span className="text-xs text-muted-foreground italic">
        (that&apos;s you)
      </span>
    );
  }

  return (
    <Button
      size="sm"
      variant={isAdmin ? "ghost" : "outline"}
      disabled={pending}
      onClick={onToggle}
    >
      {pending ? (
        <Loader2Icon className="animate-spin" />
      ) : isAdmin ? (
        <ShieldOffIcon />
      ) : (
        <ShieldIcon />
      )}
      {isAdmin ? "Demote" : "Make admin"}
    </Button>
  );
}
