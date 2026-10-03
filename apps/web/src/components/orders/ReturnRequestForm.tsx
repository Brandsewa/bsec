"use client";

import React, { useState, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";


interface Item {
  id: string;
  title: string;
  variant: string | null;
  returnable: number;
  isNonReturnable?: boolean;
}

interface ReturnReason {
  id: string;
  label: string;
  photoRequirement: "required" | "optional" | "not_asked";
}

interface ExistingReturn {
  id: string;
  number: string;
  status: string;
  reason: string;
  resolution: string;
  requestedResolution: string | null;
  customerComment: string | null;
  exchangeRequest: string | null;
  decisionMessage: string | null;
  refundMethod: string | null;
  refundAmount: number | null;
  exchangeNote: string | null;
  createdAt: string;
}

interface ReturnRequestFormProps {
  token: string;
  items: Item[];
  reasons?: ReturnReason[];
  allowExchanges?: boolean;
  policyText?: string;
  instructions?: string;
  existingReturns?: ExistingReturn[];
}

export function ReturnRequestForm({
  token,
  items,
  reasons = [],
  allowExchanges = true,
  policyText,
  instructions,
  existingReturns = [],
}: ReturnRequestFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [selectedReasonId, setSelectedReasonId] = useState(reasons[0]?.id ?? "damaged_or_defective");
  const [customReason, setCustomReason] = useState("");
  const [resolution, setResolution] = useState<"refund" | "replacement">("refund");
  const [exchangeRequest, setExchangeRequest] = useState("");
  const [customerComment, setCustomerComment] = useState("");
  const [photos, setPhotos] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const available = items.filter((i) => i.returnable > 0);
  const currentReasonObj = reasons.find((r) => r.id === selectedReasonId) ?? reasons[0];
  const photoRequired = currentReasonObj?.photoRequirement === "required";

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    if (photos.length + files.length > 5) {
      setError("You can attach up to 5 photos.");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      for (const file of files) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
          throw new Error(`File ${file.name} is not a JPEG, PNG, or WebP image.`);
        }
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(`File ${file.name} exceeds the 5 MB limit.`);
        }

        // 1. Get presigned upload descriptor
        const prepRes = await fetch(`/api/storefront/orders/${encodeURIComponent(token)}/return/photo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mime: file.type,
            bytes: file.size,
          }),
        });
        const prep = await prepRes.json();
        if (!prepRes.ok) throw new Error(prep.error ?? "Failed to prepare upload");

        // 2. Upload directly to storage via presigned PUT
        const uploadRes = await fetch(prep.uploadUrl, {
          method: "PUT",
          headers: prep.headers,
          body: file,
        });
        if (!uploadRes.ok) throw new Error(`Failed to upload ${file.name}`);

        // 3. Finalize upload
        const finRes = await fetch(`/api/storefront/orders/${encodeURIComponent(token)}/return/photo/finalize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mediaId: prep.mediaId,
            storageKey: prep.storageKey,
            filename: file.name,
            bytes: file.size,
            mime: file.type,
          }),
        });
        const fin = await finRes.json();
        if (!finRes.ok) throw new Error(fin.error ?? "Failed to finalize photo");

        setPhotos((prev) => [
          ...prev,
          { id: fin.id, name: file.name, url: URL.createObjectURL(file) },
        ]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload photo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleCancelReturn(returnId: string) {
    if (!window.confirm("Are you sure you want to cancel this return request?")) return;
    setCancellingId(returnId);
    setError(null);
    try {
      const res = await fetch(`/api/storefront/orders/${encodeURIComponent(token)}/return/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnId, reason: "Cancelled by customer" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel return");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel return");
    } finally {
      setCancellingId(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const chosen = available
      .map((i) => ({ orderItemId: i.id, quantity: qty[i.id] ?? 0 }))
      .filter((i) => i.quantity > 0);

    if (chosen.length === 0) return setError("Choose at least one item to return");

    const reasonLabel = currentReasonObj?.label ?? customReason.trim();
    if (!reasonLabel || reasonLabel.length < 3) {
      return setError("Please specify why you want to return this item.");
    }

    if (resolution === "replacement" && !exchangeRequest.trim()) {
      return setError("Please specify what item or size you want in exchange.");
    }

    if (photoRequired && photos.length === 0) {
      return setError("Photo proof is required for this return reason.");
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/storefront/orders/${encodeURIComponent(token)}/return`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: reasonLabel,
          resolution,
          exchangeRequest: resolution === "replacement" ? exchangeRequest.trim() : undefined,
          customerComment: customerComment.trim() || undefined,
          photos: photos.map((p) => p.id),
          items: chosen,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not send your return request");
      setOpen(false);
      setQty({});
      setCustomReason("");
      setExchangeRequest("");
      setCustomerComment("");
      setPhotos([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your return request");
    } finally {
      setBusy(false);
    }
  }

  if (available.length === 0 && existingReturns.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Existing Returns List */}
      {existingReturns.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Return & Exchange Requests</h3>
          <div className="divide-y divide-border rounded-xl border border-border bg-card">
            {existingReturns.map((r) => (
              <div key={r.id} className="p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">{r.number}</span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold uppercase text-muted-foreground">
                      {r.status.replace(/_/g, " ")}
                    </span>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {r.resolution === "replacement" ? "Exchange" : "Refund"}
                    </span>
                  </div>
                  {r.status === "requested" && (
                    <button
                      type="button"
                      disabled={cancellingId === r.id}
                      onClick={() => handleCancelReturn(r.id)}
                      className="text-xs text-destructive hover:underline disabled:opacity-50"
                    >
                      {cancellingId === r.id ? "Cancelling..." : "Cancel request"}
                    </button>
                  )}
                </div>

                <p className="text-foreground">Reason: <span className="text-muted-foreground">{r.reason}</span></p>

                {r.exchangeRequest && (
                  <p className="text-xs text-muted-foreground">Exchange request: {r.exchangeRequest}</p>
                )}

                {r.decisionMessage && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2.5 text-xs text-blue-900">
                    <span className="font-semibold">Message from store:</span> {r.decisionMessage}
                  </div>
                )}

                {r.status === "approved" && instructions && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 text-xs text-emerald-900">
                    <span className="font-semibold">Return instructions:</span> {instructions}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Return Request Action */}
      {available.length > 0 && (
        <>
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Request a return or exchange
            </button>
          ) : (
            <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-5" data-testid="return-form">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">Request a Return / Exchange</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Close form"
                >
                  <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {policyText && (
                <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Return Policy:</span> {policyText}
                </div>
              )}

              {/* Items Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Choose Items</label>
                <div className="space-y-2">
                  {available.map((i) => (
                    <label key={i.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                      <div>
                        <span className="font-medium text-foreground">{i.title}</span>
                        {i.variant ? <span className="text-xs text-muted-foreground"> ({i.variant})</span> : null}
                      </div>
                      <select
                        aria-label={`Quantity of ${i.title} to return`}
                        value={qty[i.id] ?? 0}
                        onChange={(e) => setQty({ ...qty, [i.id]: Number(e.target.value) })}
                        className="rounded-md border border-border bg-background px-2.5 py-1 text-sm text-foreground"
                      >
                        {Array.from({ length: i.returnable + 1 }, (_, n) => (
                          <option key={n} value={n}>
                            {n} {n === 1 ? "unit" : "units"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>

              {/* Resolution Type */}
              {allowExchanges && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What would you prefer?</label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`flex cursor-pointer items-center justify-center rounded-lg border p-3 text-sm font-medium ${resolution === "refund" ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground"}`}>
                      <input
                        type="radio"
                        name="resolution"
                        value="refund"
                        checked={resolution === "refund"}
                        onChange={() => setResolution("refund")}
                        className="sr-only"
                      />
                      Refund
                    </label>
                    <label className={`flex cursor-pointer items-center justify-center rounded-lg border p-3 text-sm font-medium ${resolution === "replacement" ? "border-primary bg-primary/5 text-primary" : "border-border text-foreground"}`}>
                      <input
                        type="radio"
                        name="resolution"
                        value="replacement"
                        checked={resolution === "replacement"}
                        onChange={() => setResolution("replacement")}
                        className="sr-only"
                      />
                      Exchange
                    </label>
                  </div>
                </div>
              )}

              {/* Exchange Item Request */}
              {resolution === "replacement" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Exchange request details *</label>
                  <input
                    required
                    maxLength={200}
                    placeholder="e.g. Please replace with Size L / Blue color"
                    value={exchangeRequest}
                    onChange={(e) => setExchangeRequest(e.target.value)}
                    className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  />
                </div>
              )}

              {/* Reason Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason for Return *</label>
                {reasons.length > 0 ? (
                  <select
                    value={selectedReasonId}
                    onChange={(e) => setSelectedReasonId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  >
                    {reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    minLength={3}
                    maxLength={100}
                    placeholder="Reason (damaged, wrong item, etc.)"
                    value={customReason}
                    onChange={(e) => setCustomReason(e.target.value)}
                    className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  />
                )}
              </div>

              {/* Additional Comments */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Additional details (optional)</label>
                <textarea
                  maxLength={500}
                  value={customerComment}
                  onChange={(e) => setCustomerComment(e.target.value)}
                  placeholder="Tell us more about the issue..."
                  className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground"
                  rows={2}
                />
              </div>

              {/* Photo Upload */}
              {currentReasonObj?.photoRequirement !== "not_asked" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Attach Photos {photoRequired ? "*" : "(optional)"}
                    </label>
                    <span className="text-[11px] text-muted-foreground">{photos.length}/5 photos</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {photos.map((p) => (
                      <div key={p.id} className="relative size-16 overflow-hidden rounded-md border border-border">
                        <Image src={p.url} alt={p.name} fill unoptimized className="object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(p.id)}
                          className="absolute right-1 top-1 z-10 rounded-full bg-black/60 p-0.5 text-white hover:bg-black"
                          aria-label="Remove photo"
                        >
                          <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}

                    {photos.length < 5 && (
                      <label className="flex size-16 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-border hover:bg-muted">
                        <svg className="size-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                        </svg>
                        <span className="text-[10px] text-muted-foreground mt-0.5">{uploading ? "..." : "+ Add"}</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          disabled={uploading}
                          onChange={handleFileUpload}
                          className="sr-only"
                        />
                      </label>
                    )}
                  </div>
                  {photoRequired && photos.length === 0 && (
                    <p className="text-xs text-amber-600">Please attach at least one photo showing the issue.</p>
                  )}
                </div>
              )}

              {error && (
                <p role="alert" className="text-xs text-destructive flex items-center gap-1.5">
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>{error}</span>
                </p>
              )}

              <div className="flex gap-2 pt-2 border-t border-border">
                <button
                  type="submit"
                  disabled={busy || uploading}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Submitting..." : "Submit request"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
