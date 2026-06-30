"use client";

import * as React from "react";
import Link from "next/link";
import {
  LayoutTemplateIcon,
  MoreHorizontalIcon,
  PhoneCallIcon,
  SettingsIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CampaignUploadDialog } from "@/components/app/campaign-upload-dialog";
import { TestCallDialog } from "@/components/app/test-call-dialog";
import { VoiceConfigDialog } from "@/components/app/voice-config-dialog";

// The Campaigns page header actions. One primary CTA (Create a Campaign) keeps
// the focus clear; the rest (Templates + the two utility dialogs) tuck into a
// single "More" menu so the header stays uncluttered.
export function CampaignHeaderActions({
  organisationId,
}: {
  organisationId: string;
}) {
  const [testOpen, setTestOpen] = React.useState(false);
  const [voiceOpen, setVoiceOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-2">
      <CampaignUploadDialog organisationId={organisationId} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="icon" aria-label="More actions">
              <MoreHorizontalIcon />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem render={<Link href="/campaigns/templates" />}>
            <LayoutTemplateIcon /> Templates
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTestOpen(true)}>
            <PhoneCallIcon /> Test call
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setVoiceOpen(true)}>
            <SettingsIcon /> Manage agents &amp; numbers
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Controlled, trigger-less — opened from the menu items above. */}
      <TestCallDialog
        organisationId={organisationId}
        open={testOpen}
        onOpenChange={setTestOpen}
        showTrigger={false}
      />
      <VoiceConfigDialog
        organisationId={organisationId}
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        showTrigger={false}
      />
    </div>
  );
}
