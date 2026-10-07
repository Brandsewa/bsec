import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UserPlus, KeyRound, CheckCircle2, UserX } from "lucide-react";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  PageContainer,
  PageHeader,
  PageSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole, useStaff } from "../lib/user-context.tsx";

type StaffRole = "platform_owner" | "platform_admin" | "platform_support";

export function Staff() {
  const me = useStaff();
  const isOwner = useHasRole("platform_owner");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>("platform_support");

  const [createdInvite, setCreatedInvite] = useState<{ email: string; url: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<{ userId: string; email: string } | null>(null);

  const { data: staffList, isLoading, refetch } = useQuery({
    queryKey: ["platform", "staff"],
    queryFn: () => client.staff.list(),
  });

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setActionLoading(true);
    try {
      const res = await client.staff.invite({
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      setCreatedInvite({ email: res.email, url: res.inviteUrl });
      toast.success(`Platform staff invitation created for ${res.email}`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to invite staff member"));
    } finally {
      setActionLoading(false);
    }
  };

  const executeDeactivate = async (userId: string, email: string) => {
    setActionLoading(true);
    try {
      await client.staff.deactivate({ userId });
      toast.success(`Deactivated staff ${email}. Active sessions revoked.`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to deactivate staff member"));
    } finally {
      setActionLoading(false);
      setDeactivateTarget(null);
    }
  };

  const handleReactivate = async (userId: string, email: string) => {
    setActionLoading(true);
    try {
      await client.staff.reactivate({ userId });
      toast.success(`Reactivated staff ${email}`);
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to reactivate staff member"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: StaffRole) => {
    setActionLoading(true);
    try {
      await client.staff.updateRole({ userId, role: newRole });
      toast.success("Platform staff role updated");
      refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to update staff role"));
    } finally {
      setActionLoading(false);
    }
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <PageContainer size="full">
      <PageHeader
        title="Platform Staff & Security"
        description="Authorized platform operators with verified multi-factor authentication (MFA). Deactivating staff kills all active sessions immediately."
        aside={
          <Button size="sm" onClick={() => { setCreatedInvite(null); setInviteOpen(true); }}>
            <UserPlus className="mr-1.5 h-4 w-4" /> Invite Staff
          </Button>
        }
      />

      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="px-4">Staff Member</TableHead>
              <TableHead>Platform Role</TableHead>
              <TableHead>MFA Status</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right px-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!staffList || staffList.length === 0) ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-xs text-muted-foreground">
                  No platform staff found.
                </TableCell>
              </TableRow>
            ) : (
              staffList.map((s) => (
                <TableRow key={s.userId} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="px-4">
                    <div className="font-medium text-xs text-foreground">{s.name || s.email}</div>
                    <div className="text-muted-foreground text-[11px]">{s.email}</div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={s.role}
                      onValueChange={(val) => handleRoleChange(s.userId, val as StaffRole)}
                      disabled={actionLoading || !s.isActive || !isOwner}
                    >
                      <SelectTrigger className="h-7 text-xs w-[150px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="platform_owner">Platform Owner</SelectItem>
                        <SelectItem value="platform_admin">Platform Admin</SelectItem>
                        <SelectItem value="platform_support">Platform Support</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {s.twoFactorEnabled ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Enrolled (Verified)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
                        <KeyRound className="h-3.5 w-3.5" /> Required at Login
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.isActive
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-destructive/10 text-destructive font-medium"
                    }`}>
                      {s.isActive ? "Active" : "Deactivated"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right px-4">
                    {s.userId === me.id ? (
                      <span className="text-xs text-muted-foreground font-medium">You</span>
                    ) : s.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:bg-destructive/10"
                        disabled={actionLoading}
                        onClick={() => setDeactivateTarget({ userId: s.userId, email: s.email })}
                      >
                        <UserX className="mr-1 h-3 w-3" /> Deactivate
                      </Button>
                    ) : isOwner ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        disabled={actionLoading}
                        onClick={() => handleReactivate(s.userId, s.email)}
                      >
                        Reactivate
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null);
        }}
        title="Deactivate staff member?"
        description={
          deactivateTarget
            ? `Are you sure you want to deactivate ${deactivateTarget.email}? All their active sessions will be terminated immediately.`
            : ""
        }
        confirmLabel="Deactivate"
        destructive
        onConfirm={async () => {
          if (deactivateTarget) {
            await executeDeactivate(deactivateTarget.userId, deactivateTarget.email);
          }
        }}
      />

      {/* Invite Staff Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Platform Staff</DialogTitle>
            <DialogDescription>
              Invited staff will receive access to the Super Admin. Mandatory MFA setup will be required.
            </DialogDescription>
          </DialogHeader>

          {createdInvite ? (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                Invitation created successfully for <strong>{createdInvite.email}</strong>.
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold">Invitation link (shown once, valid 7 days, single use)</label>
                <Input readOnly value={createdInvite.url} className="font-mono text-xs select-all bg-muted" />
                <p className="text-[11px] text-muted-foreground">
                  Nothing is emailed automatically. Send this link to the person yourself. Only its hash is stored, so it cannot be shown again: issue a new invitation if it is lost.
                </p>
                <Button type="button" size="sm" variant="default" onClick={() => void navigator.clipboard?.writeText(createdInvite.url)}>Copy link</Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setInviteOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-4 py-2 text-xs">
              <div>
                <label className="font-semibold">Staff Email Address *</label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@platform.bcom.si"
                  required
                />
              </div>
              <div>
                <label className="font-semibold">Assigned Platform Role</label>
                <Select value={inviteRole} onValueChange={(val) => setInviteRole(val as StaffRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {isOwner && <SelectItem value="platform_owner">Platform Owner (Full administrative control)</SelectItem>}
                    <SelectItem value="platform_admin">Platform Admin (Tenant and feature operations)</SelectItem>
                    <SelectItem value="platform_support">Platform Support (Audited support sessions)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button variant="default" type="button" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={actionLoading}>
                  {actionLoading ? "Issuing..." : "Send Invitation"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
