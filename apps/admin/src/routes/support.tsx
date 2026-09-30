import { createFileRoute, redirect } from "@tanstack/react-router";
import { Button, EmptyState, PageContainer, PageSkeleton } from "@bs/ui";
import { ShieldAlert } from "lucide-react";
import { readSupportHandoff, setSupportSession } from "../lib/support.ts";

/**
 * Landing page of a platform support link (opened from the Super Admin): keeps the token for this browser tab only and
 * enters the store admin. The token is in the URL fragment, so it is never sent to the server as part of this request.
 */
export const Route = createFileRoute("/support")({
  pendingComponent: () => <PageSkeleton />,
  beforeLoad: ({ context }) => {
    const handoff = typeof window === "undefined" ? null : readSupportHandoff(window.location.hash);
    if (!handoff) return;
    setSupportSession(handoff.token, handoff.storeId);
    // Remove the token from the address bar and history, then start from a clean cache.
    window.history.replaceState(null, "", "/support");
    context.queryClient.clear();
    throw redirect({ to: "/" });
  },
  component: function SupportLinkInvalid() {
    return (
      <PageContainer size="small">
        <EmptyState
          icon={ShieldAlert}
          title="This support link is not valid"
          description="Open it again from the Super Admin. Links are single-use and only shown when a support session is created."
          action={<Button onClick={() => window.location.assign("/login")}>Go to sign in</Button>}
        />
      </PageContainer>
    );
  },
});
