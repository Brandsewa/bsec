import { createFileRoute } from "@tanstack/react-router";
import { PageContainer, PageHeader, PageSkeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@bs/ui";
import { ProfileTab } from "../../components/account/profile-tab.tsx";
import { SecurityTab } from "../../components/account/security-tab.tsx";

type AccountSearch = { tab?: "security" | undefined };

export const Route = createFileRoute("/_store/account")({
  pendingComponent: () => <PageSkeleton />,
  validateSearch: (s: Record<string, unknown>): AccountSearch => ({ tab: s.tab === "security" ? "security" : undefined }),
  component: AccountPage,
});

/** The signed-in person's own profile and sign-in security. Access to the store is managed under Settings, Users. */
function AccountPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PageContainer>
      <PageHeader title="My account" description="Your details, how the admin looks for you, and how you sign in." />
      <div className="grid w-full max-w-3xl gap-5">
      <Tabs value={tab ?? "profile"} onValueChange={(v) => void navigate({ search: { tab: v === "security" ? "security" : undefined }, replace: true })}>
        <TabsList>
          <TabsTrigger value="profile">My profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-3">
          <ProfileTab />
        </TabsContent>
        <TabsContent value="security" className="mt-3">
          <SecurityTab />
        </TabsContent>
      </Tabs>
      </div>
    </PageContainer>
  );
}
