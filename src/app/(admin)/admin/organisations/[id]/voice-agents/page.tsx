import { redirect } from "next/navigation";

/**
 * Moved into the Integrations hub.
 *
 * Kept as a redirect rather than deleted: this URL is linked from the org
 * overview, from the voice-agent banner, and from anywhere anyone bookmarked it.
 * A 404 would read as a missing feature rather than a moved page.
 */
export default async function AdminOrganisationVoiceAgentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/organisations/${id}/integrations?tab=voice`);
}
