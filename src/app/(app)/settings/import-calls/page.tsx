import { CallsCsvImporter } from "@/components/app/calls-csv-importer";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Import calls · Skelo" };

// requireSession() only returns workspaces where owner_id = auth.uid(), so
// landing on this route already implies the caller owns the org. No second
// gate needed here.
export default async function ImportCallsPage() {
  await requireSession();

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Import calls
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Upload a Bolna call export CSV to backfill your call history. Existing
          calls are detected by id and skipped, and rows with a matching phone
          number are linked to the right lead automatically.
        </p>
      </header>

      <CallsCsvImporter />
    </div>
  );
}
