import { useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bs/ui";
import { Button } from "@bs/ui";
import { Input } from "@bs/ui";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@bs/ui";
import { changePassword } from "../../lib/auth.ts";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccess(false);
    setBusy(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetForm();
    onOpenChange(nextOpen);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10) {
      setError("New password must be at least 10 characters long.");
      return;
    }
    if (newPassword.length > 128) {
      setError("New password cannot exceed 128 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
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
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Update your store admin account password. All other active sessions will be signed out.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="grid gap-4 py-2">
            <div className="rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-700 border border-emerald-500/20 font-medium">
              Your password has been changed successfully. Other active sessions have been signed out.
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)} size="sm">
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  autoFocus
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="dialog-new-password">New password</FieldLabel>
                <Input
                  id="dialog-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <FieldDescription>At least 10 characters</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="dialog-confirm-password">Confirm new password</FieldLabel>
                <Input
                  id="dialog-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </Field>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>
                {busy ? "Updating…" : "Update password"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
