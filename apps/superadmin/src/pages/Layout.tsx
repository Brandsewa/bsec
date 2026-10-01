import React, { useState, type FormEvent } from "react";
import { Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Building2,
  CreditCard,
  Database,
  FileSpreadsheet,
  Flag,
  Globe,
  Headphones,
  KeyRound,
  LayoutDashboard,
  Layers,
  LogOut,
  Mail,
  Sliders,
  UserCheck,
  Users,
} from "lucide-react";
import {
  AppShell,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  type NavGroup,
} from "@bs/ui";
import { changePassword, signOut, type PlatformUser } from "../lib/auth.ts";
import { UserContext } from "../lib/user-context.tsx";

interface LayoutProps {
  user: PlatformUser;
  onLogout: () => void;
}

const navGroups: NavGroup[] = [
  {
    items: [{ label: "Overview", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Commerce & Stores",
    items: [
      { label: "Tenants", href: "/tenants", icon: Building2 },
      { label: "Domains", href: "/domains", icon: Globe },
      { label: "Plans & Billing", href: "/plans", icon: CreditCard },
      { label: "Signups Funnel", href: "/signups", icon: Users },
      { label: "Themes", href: "/templates", icon: Layers },
    ],
  },
  {
    label: "Operations & Support",
    items: [
      { label: "Support Sessions", href: "/support", icon: Headphones },
      { label: "System & Queues", href: "/system", icon: Activity },
      { label: "Email (ZeptoMail)", href: "/email", icon: Mail },
      { label: "Quotas & Tiers", href: "/quotas", icon: Sliders },
      { label: "Feature Flags", href: "/features", icon: Flag },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Platform Staff", href: "/staff", icon: UserCheck },
      { label: "Audit Log", href: "/audit", icon: FileSpreadsheet },
    ],
  },
];

export function Layout({ user, onLogout }: LayoutProps) {
  const location = useLocation();
  // The staff list is admin-only on the server; do not show support staff a page that would be refused.
  const groups = navGroups.map((g) => ({
    ...g,
    items: g.items.filter((i) => !(i.href === "/staff" && user.role === "platform_support")),
  }));
  const navigate = useNavigate();

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const resetPasswordForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccess(false);
    setBusy(false);
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 10) {
      setError("New password must be at least 10 characters.");
      return;
    }
    if (newPassword.length > 128) {
      setError("New password cannot exceed 128 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);

    const res = await changePassword(currentPassword, newPassword);
    setBusy(false);

    if (!res.ok) {
      setError(res.message);
      return;
    }

    setSuccess(true);
  };

  const handleSignOut = async () => {
    await signOut();
    onLogout();
    navigate({ to: "/login" });
  };

  return (
    <UserContext.Provider value={user}>
      <AppShell
        brand={
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <span className="text-sm font-bold tracking-tight">Super Admin</span>
          </div>
        }
        groups={groups}
        activeHref={location.pathname}
        banner={
          <div className="flex items-center justify-between bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 border-b border-amber-500/20">
            <span>Super Admin Mode · Every privileged action is audited under platform BYPASSRLS</span>
            <div className="flex items-center gap-3">
              <span>Staff: <strong className="font-semibold">{user.email}</strong> · {user.role.replace("platform_", "")}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  resetPasswordForm();
                  setPasswordOpen(true);
                }}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <KeyRound className="mr-1 h-3 w-3" />
                Change Password
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <LogOut className="mr-1 h-3 w-3" />
                Sign Out
              </Button>
            </div>
          </div>
        }
      >
        <Outlet />
      </AppShell>

      <Dialog open={passwordOpen} onOpenChange={(open) => {
        if (!open) resetPasswordForm();
        setPasswordOpen(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Platform Password</DialogTitle>
            <DialogDescription>
              Update your password. All other active platform sessions will be signed out.
            </DialogDescription>
          </DialogHeader>

          {success ? (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-700 border border-emerald-500/20 font-medium">
                Your password has been changed successfully. Other active sessions have been signed out.
              </div>
              <DialogFooter>
                <Button onClick={() => setPasswordOpen(false)} size="sm">
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <Label htmlFor="current-pw">Current Password</Label>
                <Input
                  id="current-pw"
                  type="password"
                  required
                  autoFocus
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="new-pw">New Password (min 10 characters)</Label>
                <Input
                  id="new-pw"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="confirm-pw">Confirm New Password</Label>
                <Input
                  id="confirm-pw"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              {error && (
                <div role="alert" className="rounded-md bg-destructive/10 p-2 text-xs text-destructive font-medium border border-destructive/20">
                  {error}
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPasswordOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>
                  {busy ? "Updating…" : "Update Password"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </UserContext.Provider>
  );
}
