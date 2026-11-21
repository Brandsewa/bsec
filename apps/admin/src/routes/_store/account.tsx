import { createFileRoute } from "@tanstack/react-router";
import { Activity, Bell, Lock, ShieldCheck, UserRound } from "lucide-react";
import { PageContainer, PageHeader, PageSkeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@bs/ui";
import { ActivityTab } from "../../components/account/activity-tab.tsx";
import { NotificationsTab } from "../../components/account/notifications-tab.tsx";
import { PermissionsTab } from "../../components/account/permissions-tab.tsx";
import { ProfileTab } from "../../components/account/profile-tab.tsx";
import { SecurityTab } from "../../components/account/security-tab.tsx";

const TABS = ["profile", "security", "notifications", "permissions", "activity"] as const;
type AccountTab = (typeof TABS)[number];
type AccountSearch = { tab?: Exclude<AccountTab, "profile"> | undefined };

const isTab = (v: unknown): v is AccountTab => typeof v === "string" && (TABS as readonly string[]).includes(v);

export const Route = createFileRoute("/_store/account")({
  pendingComponent: () => <PageSkeleton />,
  validateSearch: (s: Record<string, unknown>): AccountSearch => ({ tab: isTab(s.tab) && s.tab !== "profile" ? s.tab : undefined }),
  component: AccountPage,
});

const TAB_DEFS: { value: AccountTab; label: string; Icon: typeof UserRound }[] = [
  { value: "profile", label: "Profile", Icon: UserRound },
  { value: "security", label: "Security", Icon: Lock },
  { value: "notifications", label: "Notifications", Icon: Bell },
  { value: "permissions", label: "Permissions", Icon: ShieldCheck },
  { value: "activity", label: "Activity", Icon: Activity },
];

/** The signed-in person's own profile, sign-in security, alerts, access and activity. Everyone's access is under Settings, Users. */
function AccountPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PageContainer>
      <PageHeader title="My account" description="Your details, how you sign in, the alerts you get and what you can access." />
      <div className="grid w-full min-w-0 max-w-3xl gap-5">
        <Tabs className="min-w-0" value={tab ?? "profile"} onValueChange={(v) => void navigate({ search: { tab: isTab(v) && v !== "profile" ? v : undefined }, replace: true })}>
          {/* Scrolls sideways on a phone instead of squeezing five labelled tabs into 375 px. */}
          <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList aria-label="Account sections">
              {TAB_DEFS.map(({ value, label, Icon }) => (
                <TabsTrigger key={value} value={value} className="shrink-0 gap-1.5">
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="profile" className="mt-3">
            <ProfileTab />
          </TabsContent>
          <TabsContent value="security" className="mt-3">
            <SecurityTab />
          </TabsContent>
          <TabsContent value="notifications" className="mt-3">
            <NotificationsTab />
          </TabsContent>
          <TabsContent value="permissions" className="mt-3">
            <PermissionsTab />
          </TabsContent>
          <TabsContent value="activity" className="mt-3">
            <ActivityTab />
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  );
}
