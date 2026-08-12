import { redirect } from "next/navigation";

/**
 * Moved into the Integrations hub.
 *
 * Kept as a redirect rather than deleted — see the note on the voice-agents
 * route. The Shopify OAuth install flow also bounces admins back to this path
 * after authorising a store, so removing it would break that return trip.
 */
export default async function AdminOrganisationShopifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/organisations/${id}/integrations?tab=shopify`);
}
