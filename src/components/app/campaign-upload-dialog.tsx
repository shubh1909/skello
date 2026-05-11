"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  DownloadIcon,
  FileTextIcon,
  Loader2Icon,
  UploadCloudIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VoiceConfigDialog } from "@/components/app/voice-config-dialog";
import { createCampaign } from "@/actions/campaigns";
import { getVoiceConfig } from "@/actions/voice-config";
import {
  parseCampaignCsv,
  type ParsedCsv,
} from "@/lib/campaigns/csv-parse";
import { cn } from "@/lib/utils";
import type { CampaignRetryTrigger } from "@/types/campaign";
import type { VoiceConfig } from "@/types/voice-config";

type ScheduleMode = "now" | "later";

const RETRY_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: 5 * 60, label: "5 min" },
  { value: 15 * 60, label: "15 min" },
  { value: 30 * 60, label: "30 min" },
  { value: 60 * 60, label: "60 min" },
  { value: 4 * 60 * 60, label: "4 hr" },
  { value: 24 * 60 * 60, label: "24 hr" },
];

const RETRY_TRIGGER_OPTIONS: { value: CampaignRetryTrigger; label: string; hint: string }[] = [
  { value: "no_answer", label: "No answer", hint: "Recipient did not pick up" },
  { value: "busy", label: "Busy", hint: "Line was busy" },
  { value: "failed", label: "Failed", hint: "Provider error or unreachable" },
  { value: "canceled", label: "Canceled", hint: "Call ended before connect" },
];

const DEFAULT_RETRY_TRIGGERS: CampaignRetryTrigger[] = [
  "no_answer",
  "busy",
  "failed",
];

// Lightweight, self-contained sample so users can see exactly what we accept.
// `phone` and `name` are the recognized columns; the extra columns demonstrate
// how arbitrary fields flow through to the voice agent as call metadata.
const SAMPLE_CSV =
  "phone,name,vehicle,city,last_visit\r\n" +
  "+91 99999 00000,Neem Kumar,Honda Dio,Bengaluru,2026-04-22\r\n" +
  "9810000111,Priya Sharma,Royal Enfield Classic 350,Pune,\r\n" +
  "+1 (415) 555-0199,Alex Patel,Tesla Model 3,San Francisco,2026-04-30\r\n";

function downloadSampleCsv() {
  const blob = new Blob([`﻿${SAMPLE_CSV}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "skelo-campaign-sample.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function defaultScheduleAt(): string {
  const d = new Date(Date.now() + 30 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultAgentPlaceholder(c: VoiceConfig | null): string {
  if (!c) return "Loading…";
  if (c.agents.length === 0) return "No agents — open Manage to add one";
  return "Workspace default";
}

function defaultNumberPlaceholder(c: VoiceConfig | null): string {
  if (!c) return "Loading…";
  if (c.dial_numbers.length === 0)
    return "No numbers — open Manage to add one";
  return "Workspace default";
}

interface CampaignUploadDialogProps {
  organisationId: string;
}

export function CampaignUploadDialog({
  organisationId,
}: CampaignUploadDialogProps) {
  const router = useRouter();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [parsed, setParsed] = React.useState<ParsedCsv | null>(null);
  const [parsing, setParsing] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [scheduleMode, setScheduleMode] = React.useState<ScheduleMode>("now");
  const [scheduledAt, setScheduledAt] = React.useState<string>(
    defaultScheduleAt(),
  );
  const [retries, setRetries] = React.useState<number>(2);
  const [retryInterval, setRetryInterval] = React.useState<number>(15 * 60);
  const [retryOn, setRetryOn] = React.useState<CampaignRetryTrigger[]>(
    DEFAULT_RETRY_TRIGGERS,
  );
  const [submitting, setSubmitting] = React.useState(false);

  // Voice config (agents + dialling numbers). Fetched lazily once the dialog
  // opens; the empty-string select value means "use the workspace default".
  const [voiceConfig, setVoiceConfig] = React.useState<VoiceConfig | null>(
    null,
  );
  const [voiceLoading, setVoiceLoading] = React.useState(false);
  const [agentChoice, setAgentChoice] = React.useState<string>("");
  const [fromPhoneChoice, setFromPhoneChoice] = React.useState<string>("");

  const loadVoiceConfig = React.useCallback(async () => {
    setVoiceLoading(true);
    const res = await getVoiceConfig({ organisation_id: organisationId });
    setVoiceLoading(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setVoiceConfig(res.data);
    // Auto-select the workspace default so the user doesn't have to think
    // about it for the common case. Only sets if the user hasn't picked yet.
    setAgentChoice((prev) => {
      if (prev) return prev;
      const def = res.data.agents.find((a) => a.is_default);
      return def ? def.id : "";
    });
    setFromPhoneChoice((prev) => {
      if (prev) return prev;
      const def = res.data.dial_numbers.find((n) => n.is_default);
      return def ? def.phone : "";
    });
  }, [organisationId]);

  function reset() {
    setName("");
    setFile(null);
    setParsed(null);
    setParsing(false);
    setDragOver(false);
    setScheduleMode("now");
    setScheduledAt(defaultScheduleAt());
    setRetries(2);
    setRetryInterval(15 * 60);
    setRetryOn(DEFAULT_RETRY_TRIGGERS);
    setSubmitting(false);
    setAgentChoice("");
    setFromPhoneChoice("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
    if (next) void loadVoiceConfig();
  }

  async function ingestFile(f: File | null) {
    setFile(f);
    setParsed(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      toast.error("Please drop a .csv file");
      setFile(null);
      return;
    }
    if (!name) {
      const base = f.name.replace(/\.[^.]+$/, "");
      setName(base.slice(0, 200));
    }
    setParsing(true);
    try {
      const result = await parseCampaignCsv(f);
      setParsed(result);
      if (result.error && result.valid_rows === 0) {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not parse CSV");
    } finally {
      setParsing(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    void ingestFile(e.target.files?.[0] ?? null);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (submitting || parsing) return;
    const f = e.dataTransfer.files?.[0] ?? null;
    void ingestFile(f);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (submitting || parsing) return;
    if (!dragOver) setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only reset when leaving the dropzone container, not its children.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  function clearFile(e: React.MouseEvent) {
    e.stopPropagation();
    setFile(null);
    setParsed(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function toggleRetryTrigger(t: CampaignRetryTrigger) {
    setRetryOn((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  async function onConfirm() {
    if (!name.trim()) {
      toast.error("Give the campaign a name");
      return;
    }
    if (!parsed || parsed.valid_rows === 0) {
      toast.error("Upload a CSV with at least one valid phone number");
      return;
    }
    if (scheduleMode === "later") {
      const ts = new Date(scheduledAt);
      if (Number.isNaN(ts.getTime()) || ts.getTime() < Date.now() - 60_000) {
        toast.error("Pick a future date and time to schedule");
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await createCampaign({
        organisation_id: organisationId,
        name: name.trim(),
        file_name: file?.name ?? null,
        schedule_mode: scheduleMode,
        scheduled_at:
          scheduleMode === "later"
            ? new Date(scheduledAt).toISOString()
            : null,
        // Empty string = "use workspace default"; the action treats null/empty
        // identically and falls back at dispatch time.
        agent_id: agentChoice || null,
        from_phone_number: fromPhoneChoice || null,
        max_attempts: retries + 1,
        retry_interval_seconds: retryInterval,
        retry_on: retryOn,
        contacts: parsed.contacts,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        scheduleMode === "now"
          ? `Campaign started — dialing ${parsed.valid_rows} contacts`
          : `Campaign scheduled for ${new Date(scheduledAt).toLocaleString()}`,
      );
      setOpen(false);
      reset();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const confirmLabel =
    scheduleMode === "now" ? "Start campaign" : "Schedule campaign";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button>
            <UploadIcon /> Upload
          </Button>
        }
      />
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Upload a CSV of phone numbers. We&apos;ll dial each one through
            your voice agent and retry failures based on your settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-5 overflow-y-auto pr-1">
          <div className="grid gap-1.5">
            <Label htmlFor="campaign-name">Name</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. April homebuyer follow-ups"
              maxLength={200}
              disabled={submitting}
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="campaign-file">CSV file</Label>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={downloadSampleCsv}
                disabled={submitting}
                className="-mr-2 text-muted-foreground hover:text-foreground"
                title="Download a sample CSV template"
              >
                <DownloadIcon /> Sample CSV
              </Button>
            </div>
            <input
              ref={fileInputRef}
              id="campaign-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              disabled={submitting || parsing}
              className="sr-only"
            />
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop a CSV file or click to browse"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragEnter={onDragOver}
              onDragLeave={onDragLeave}
              className={cn(
                "group relative grid cursor-pointer place-items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors outline-none",
                "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                dragOver
                  ? "border-foreground/50 bg-muted/40"
                  : file
                    ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/5"
                    : "border-border/70 bg-muted/20 hover:border-foreground/30 hover:bg-muted/30",
                (submitting || parsing) && "cursor-not-allowed opacity-70",
              )}
            >
              {parsing ? (
                <>
                  <Loader2Icon className="size-7 animate-spin text-muted-foreground" />
                  <p className="text-sm font-medium">Parsing CSV…</p>
                  <p className="text-xs text-muted-foreground">
                    Hang tight, this takes a moment for big files.
                  </p>
                </>
              ) : file && parsed ? (
                <>
                  <span className="grid size-10 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    {parsed.valid_rows > 0 ? (
                      <CheckCircle2Icon className="size-5" />
                    ) : (
                      <XCircleIcon className="size-5 text-destructive" />
                    )}
                  </span>
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium">
                    <FileTextIcon className="size-3.5" /> {file.name}
                  </p>
                  {parsed.valid_rows > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Phone column:{" "}
                      <span className="font-mono text-foreground">
                        {parsed.phone_column}
                      </span>{" "}
                      ·{" "}
                      <span className="font-medium tabular-nums text-foreground">
                        {parsed.valid_rows} valid
                      </span>{" "}
                      / {parsed.total_rows} rows
                      {parsed.duplicate_rows > 0
                        ? ` · ${parsed.duplicate_rows} duplicates skipped`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-destructive">
                      {parsed.error ?? "No valid phone numbers found"}
                    </p>
                  )}
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={clearFile}
                    disabled={submitting}
                    className="mt-1"
                  >
                    Choose a different file
                  </Button>
                </>
              ) : (
                <>
                  <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-foreground/10 group-hover:text-foreground">
                    <UploadCloudIcon className="size-5" />
                  </span>
                  <p className="text-sm font-medium">
                    {dragOver ? "Drop to upload" : "Drag & drop a CSV here"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    or{" "}
                    <span className="font-medium text-foreground underline-offset-2 group-hover:underline">
                      click to browse
                    </span>{" "}
                    · .csv only
                  </p>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Required column:</span>{" "}
              <code className="font-mono">phone</code> (also accepts{" "}
              <code className="font-mono">mobile</code> /{" "}
              <code className="font-mono">number</code>).{" "}
              <span className="font-medium text-foreground">Optional:</span>{" "}
              <code className="font-mono">name</code>. Any other columns are
              passed to the voice agent as call context.
            </p>
          </div>

          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Voice setup
              </Label>
              <VoiceConfigDialog
                organisationId={organisationId}
                onConfigChange={(c) => {
                  setVoiceConfig(c);
                  // Drop choices that no longer exist after a removal so the
                  // select doesn't show a stale value.
                  const agentSet = new Set(c.agents.map((a) => a.id));
                  if (agentChoice && !agentSet.has(agentChoice)) {
                    setAgentChoice("");
                  }
                  const phoneSet = new Set(c.dial_numbers.map((n) => n.phone));
                  if (fromPhoneChoice && !phoneSet.has(fromPhoneChoice)) {
                    setFromPhoneChoice("");
                  }
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="campaign-agent" className="text-xs">
                  Voice agent
                </Label>
                <Select
                  value={agentChoice}
                  onValueChange={(v) => setAgentChoice(v ?? "")}
                  disabled={submitting || voiceLoading}
                >
                  <SelectTrigger id="campaign-agent" className="w-full">
                    {/* Render the label, not the underlying agent_id, so the
                        trigger reads as a friendly name rather than the
                        cryptic Bolna id. */}
                    <SelectValue
                      placeholder={defaultAgentPlaceholder(voiceConfig)}
                    >
                      {(value: unknown) => {
                        if (typeof value !== "string" || !value) {
                          return defaultAgentPlaceholder(voiceConfig);
                        }
                        const found = voiceConfig?.agents.find(
                          (a) => a.id === value,
                        );
                        return found ? found.label : value;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(voiceConfig?.agents ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <span className="font-medium">{a.label}</span>
                        {a.is_default ? (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            (default)
                          </span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="campaign-from-phone" className="text-xs">
                  Dialling number
                </Label>
                <Select
                  value={fromPhoneChoice}
                  onValueChange={(v) => setFromPhoneChoice(v ?? "")}
                  disabled={submitting || voiceLoading}
                >
                  <SelectTrigger id="campaign-from-phone" className="w-full">
                    <SelectValue
                      placeholder={defaultNumberPlaceholder(voiceConfig)}
                    >
                      {(value: unknown) => {
                        if (typeof value !== "string" || !value) {
                          return defaultNumberPlaceholder(voiceConfig);
                        }
                        const found = voiceConfig?.dial_numbers.find(
                          (n) => n.phone === value,
                        );
                        return found ? found.label : value;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(voiceConfig?.dial_numbers ?? []).map((n) => (
                      <SelectItem key={n.phone} value={n.phone}>
                        <span className="font-medium">{n.label}</span>
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                          {n.phone}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Pick a voice agent from your saved list. If you don&apos;t pick
              a dialling number, we&apos;ll use the default caller ID
              configured on that voice agent.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>When to run</Label>
            <div className="grid grid-cols-2 gap-2">
              <ScheduleRadio
                checked={scheduleMode === "now"}
                onCheck={() => setScheduleMode("now")}
                title="Run now"
                hint="Start dialing immediately"
                disabled={submitting}
              />
              <ScheduleRadio
                checked={scheduleMode === "later"}
                onCheck={() => setScheduleMode("later")}
                title="Schedule for later"
                hint="Pick a date and time"
                disabled={submitting}
              />
            </div>
            {scheduleMode === "later" ? (
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={submitting}
                min={defaultScheduleAt()}
              />
            ) : null}
          </div>

          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <div className="grid gap-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="campaign-retries" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Retry settings
                </Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {retries === 0 ? "No retries" : `${retries} retr${retries === 1 ? "y" : "ies"}`}
                </span>
              </div>
              <input
                id="campaign-retries"
                type="range"
                min={0}
                max={5}
                step={1}
                value={retries}
                onChange={(e) => setRetries(Number(e.target.value))}
                disabled={submitting}
                className="w-full cursor-pointer accent-foreground"
              />
              <div className="flex justify-between px-0.5 text-[10px] text-muted-foreground">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className="tabular-nums">
                    {n}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="campaign-interval" className="text-xs">
                Wait between retries
              </Label>
              <Select
                value={String(retryInterval)}
                onValueChange={(v) => setRetryInterval(Number(v))}
                disabled={submitting || retries === 0}
              >
                <SelectTrigger id="campaign-interval" className="w-full">
                  {/* base-ui's Value renders the underlying string value
                      ("900") by default; map it back to the friendly label
                      ("15 min") so the trigger doesn't show seconds. */}
                  <SelectValue>
                    {(value: unknown) => {
                      const found = RETRY_INTERVAL_OPTIONS.find(
                        (o) => String(o.value) === value,
                      );
                      return found ? found.label : "—";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RETRY_INTERVAL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label className="text-xs">Retry when call ends in</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {RETRY_TRIGGER_OPTIONS.map((o) => {
                  const checked = retryOn.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggleRetryTrigger(o.value)}
                      disabled={submitting || retries === 0}
                      className={cn(
                        "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                        checked
                          ? "border-foreground/30 bg-background"
                          : "border-border/60 bg-transparent text-muted-foreground hover:bg-background",
                        (submitting || retries === 0) && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid size-3.5 shrink-0 place-items-center rounded border",
                          checked
                            ? "border-foreground bg-foreground text-background"
                            : "border-border",
                        )}
                        aria-hidden
                      >
                        {checked ? <CheckMark /> : null}
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span className="font-medium text-foreground">
                          {o.label}
                        </span>
                        <span className="text-[10px] leading-tight">
                          {o.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <DialogClose
            render={
              <Button variant="outline" type="button" disabled={submitting} />
            }
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={submitting || parsing || !parsed || parsed.valid_rows === 0}
          >
            {submitting ? <Loader2Icon className="animate-spin" /> : null}
            {submitting ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8.5 6.5 12 13 4.5" />
    </svg>
  );
}

function ScheduleRadio({
  checked,
  onCheck,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onCheck: () => void;
  title: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onCheck}
      disabled={disabled}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-xs transition-colors",
        checked
          ? "border-foreground/30 bg-background"
          : "border-border/60 bg-transparent text-muted-foreground hover:bg-background",
        disabled && "cursor-not-allowed opacity-60",
      )}
      aria-pressed={checked}
    >
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-[11px] leading-tight">{hint}</span>
    </button>
  );
}
