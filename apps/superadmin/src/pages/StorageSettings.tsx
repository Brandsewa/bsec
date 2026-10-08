import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  ExternalLink,
  HardDrive,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageContainer,
  PageHeader,
  PageSkeleton,
  SimpleSelect,
  Switch,
  toast,
} from "@bs/ui";
import { client } from "../lib/orpc.ts";
import { messageOf } from "../lib/errors.ts";
import { useHasRole } from "../lib/user-context.tsx";
import type { PlatformStorageConnectionView } from "@bs/contracts";

export function StorageSettings() {
  const navigate = useNavigate();
  const canEdit = useHasRole("platform_admin");

  const {
    data: connections = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["platform", "storage", "connections"],
    queryFn: () => client.storage.list(),
  });

  const { data: stats } = useQuery({
    queryKey: ["platform", "storage", "stats"],
    queryFn: () => client.storage.stats(),
  });

  // Modal State for Add / Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [formName, setFormName] = useState("");
  const [formDriver, setFormDriver] = useState<"local" | "r2" | "s3">("r2");
  const [formPurpose, setFormPurpose] = useState<"public_media" | "private_files">("public_media");
  const [formEndpoint, setFormEndpoint] = useState("");
  const [formRegion, setFormRegion] = useState("auto");
  const [formBucket, setFormBucket] = useState("");
  const [formPublicBaseUrl, setFormPublicBaseUrl] = useState("");
  const [formForcePathStyle, setFormForcePathStyle] = useState(true);
  const [formLocalDir, setFormLocalDir] = useState("./.data/media");
  const [formAccountId, setFormAccountId] = useState("");
  const [formDirectUpload, setFormDirectUpload] = useState(false);
  const [formAccessKeyId, setFormAccessKeyId] = useState("");
  const [formSecretAccessKey, setFormSecretAccessKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Testing & Action State
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    ok: boolean;
    status: string;
    error?: string | undefined;
    corsOk?: boolean | undefined;
    corsDetails?: string | undefined;
  } | null>(null);

  // Confirmation Dialog States
  const [activateTarget, setActivateTarget] = useState<PlatformStorageConnectionView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformStorageConnectionView | null>(null);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const openAddModal = (preset?: "r2" | "s3" | "local") => {
    setEditingId(null);
    const driver = preset ?? "r2";
    setFormDriver(driver);
    setFormPurpose("public_media");
    setFormDirectUpload(false); // default server-proxied for safety

    if (driver === "r2") {
      setFormName("Cloudflare R2");
      setFormEndpoint("");
      setFormRegion("auto");
      setFormBucket("");
      setFormPublicBaseUrl("https://media.bcom.si");
      setFormForcePathStyle(true);
      setFormAccountId("");
      setFormLocalDir("./.data/media");
    } else if (driver === "s3") {
      setFormName("AWS S3");
      setFormEndpoint("");
      setFormRegion("ap-south-1");
      setFormBucket("");
      setFormPublicBaseUrl("");
      setFormForcePathStyle(false);
      setFormAccountId("");
      setFormLocalDir("./.data/media");
    } else {
      setFormName("Local Filesystem");
      setFormEndpoint("");
      setFormRegion("");
      setFormBucket("");
      setFormPublicBaseUrl("");
      setFormForcePathStyle(false);
      setFormAccountId("");
      setFormLocalDir("./.data/media");
    }

    setFormAccessKeyId("");
    setFormSecretAccessKey("");
    setModalOpen(true);
  };

  const openEditModal = (conn: PlatformStorageConnectionView) => {
    setEditingId(conn.id);
    setFormName(conn.name);
    setFormDriver(conn.driver);
    setFormPurpose(conn.purpose);
    setFormEndpoint(conn.endpoint ?? "");
    setFormRegion(conn.region ?? "");
    setFormBucket(conn.bucket ?? "");
    setFormPublicBaseUrl(conn.publicBaseUrl ?? "");
    setFormForcePathStyle(Boolean(conn.forcePathStyle));
    setFormLocalDir(conn.localDir ?? "./.data/media");
    setFormAccountId(conn.accountId ?? "");
    setFormDirectUpload(Boolean(conn.directBrowserUpload));
    setFormAccessKeyId(""); // write-only
    setFormSecretAccessKey(""); // write-only
    setModalOpen(true);
  };

  const applyR2Preset = () => {
    setFormDriver("r2");
    setFormRegion("auto");
    setFormForcePathStyle(true);
    if (!formPublicBaseUrl) setFormPublicBaseUrl("https://media.bcom.si");
    if (formAccountId.trim()) {
      setFormEndpoint(`https://${formAccountId.trim()}.r2.cloudflarestorage.com`);
    }
    toast.info("Applied Cloudflare R2 presets");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error("Connection name is required");
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        await client.storage.update({
          id: editingId,
          name: formName.trim(),
          driver: formDriver,
          purpose: formPurpose,
          endpoint: formEndpoint.trim() || null,
          region: formRegion.trim() || null,
          bucket: formBucket.trim() || null,
          publicBaseUrl: formPublicBaseUrl.trim() || null,
          forcePathStyle: formForcePathStyle,
          localDir: formLocalDir.trim() || null,
          accountId: formAccountId.trim() || null,
          directBrowserUpload: formDirectUpload,
          accessKeyId: formAccessKeyId.trim() || undefined,
          secretAccessKey: formSecretAccessKey.trim() || undefined,
        });
        toast.success(`Updated storage connection "${formName}"`);
      } else {
        await client.storage.create({
          name: formName.trim(),
          driver: formDriver,
          purpose: formPurpose,
          endpoint: formEndpoint.trim() || undefined,
          region: formRegion.trim() || undefined,
          bucket: formBucket.trim() || undefined,
          publicBaseUrl: formPublicBaseUrl.trim() || undefined,
          forcePathStyle: formForcePathStyle,
          localDir: formLocalDir.trim() || undefined,
          accountId: formAccountId.trim() || undefined,
          directBrowserUpload: formDirectUpload,
          accessKeyId: formAccessKeyId.trim() || undefined,
          secretAccessKey: formSecretAccessKey.trim() || undefined,
        });
        toast.success(`Created storage connection "${formName}"`);
      }
      setModalOpen(false);
      await refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to save storage connection"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (conn: PlatformStorageConnectionView) => {
    setTestingId(conn.id);
    try {
      const res = await client.storage.test({ id: conn.id });
      setTestResult({
        id: conn.id,
        ...res,
      });

      if (res.ok) {
        if (res.corsOk === false) {
          toast.warning(`Connection test succeeded, but bucket CORS issue detected!`);
        } else {
          toast.success(`Storage connection test PASSED for "${conn.name}"`);
        }
      } else {
        toast.error(`Storage connection test FAILED: ${res.error || "Unknown error"}`);
      }
      await refetch();
    } catch (err) {
      toast.error(messageOf(err, "Storage diagnostic test failed"));
    } finally {
      setTestingId(null);
    }
  };

  const handleActivate = async () => {
    if (!activateTarget) return;
    setActivating(true);
    try {
      await client.storage.activate({ id: activateTarget.id });
      toast.success(`Activated "${activateTarget.name}" for ${activateTarget.purpose === "public_media" ? "Public Media" : "Private Files"}`);
      setActivateTarget(null);
      await refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to activate storage connection"));
    } finally {
      setActivating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await client.storage.delete({ id: deleteTarget.id });
      toast.success(`Deleted storage connection "${deleteTarget.name}"`);
      setDeleteTarget(null);
      await refetch();
    } catch (err) {
      toast.error(messageOf(err, "Failed to delete storage connection"));
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  const activeMediaConn = connections.find((c) => c.purpose === "public_media" && c.isActive);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => navigate({ to: "/integrations" })}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Integrations</span>
        </Button>
      </div>

      <PageHeader
        title="Storage Connections"
        description="Configure S3-compatible, Cloudflare R2, or local storage. Credentials are encrypted at rest with AES-256-GCM. Direct browser uploads and server-proxied streaming are supported."
        aside={
          canEdit ? (
            <div className="flex items-center gap-2">
              <Button onClick={() => openAddModal("r2")} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Connection
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Total Storage Used</div>
          <div className="text-2xl font-bold mt-1 text-primary">
            {formatBytes(stats?.totalBytes ?? 0)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Total Files</div>
          <div className="text-2xl font-bold mt-1">
            {(stats?.totalFiles ?? 0).toLocaleString()}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Active Drivers</div>
          <div className="text-2xl font-bold mt-1">
            {connections.filter((c) => c.isActive).length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-muted-foreground">Top Store by Usage</div>
          <div className="text-sm font-semibold truncate mt-1">
            {stats?.topTenants?.[0]
              ? `${stats.topTenants[0].tenantName} (${formatBytes(stats.topTenants[0].bytes)})`
              : "No media recorded"}
          </div>
        </Card>
      </div>

      {/* Overview Status Banner */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide">
              Active Public Media Driver
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              {activeMediaConn ? activeMediaConn.name : "Environment Fallback (R2 / Local)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {activeMediaConn ? (
              <div className="space-y-1">
                <p>
                  Driver: <span className="font-semibold text-foreground uppercase">{activeMediaConn.driver}</span>
                </p>
                <p>
                  Mode:{" "}
                  <span className="font-semibold text-foreground">
                    {activeMediaConn.directBrowserUpload ? "Direct SigV4 Browser Upload" : "Server-Proxied (Safe CORS)"}
                  </span>
                </p>
              </div>
            ) : (
              <p>No database connection activated. System defaults to environment variables or local directory.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide">
              Upload Resilience & CORS
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Zero Upload Failure
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Server-proxied uploads prevent browser <code className="text-[11px] bg-muted px-1 rounded">TypeError: Failed to fetch</code> errors caused by missing bucket CORS configuration.
          </CardContent>
        </Card>

        <Card className="border-border/60 sm:col-span-2 lg:col-span-1">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-medium tracking-wide">
              Quick Setup Presets
            </CardDescription>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              New Driver
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => openAddModal("r2")} disabled={!canEdit}>
              + Cloudflare R2
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAddModal("s3")} disabled={!canEdit}>
              + AWS S3
            </Button>
            <Button size="sm" variant="outline" onClick={() => openAddModal("local")} disabled={!canEdit}>
              + Local Disk
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Diagnostic Alert Banner when test fails or has CORS warnings */}
      {testResult && (
        <Alert variant={testResult.ok && testResult.corsOk !== false ? "default" : "destructive"}>
          {testResult.ok && testResult.corsOk !== false ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <AlertTitle>
            Diagnostic Test Result: {testResult.ok ? "Storage Accessible" : "Storage Test Failed"}
          </AlertTitle>
          <AlertDescription className="space-y-1 text-xs">
            {testResult.error && <p className="font-semibold text-rose-600 dark:text-rose-400">{testResult.error}</p>}
            {testResult.corsDetails && (
              <p className="mt-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 p-2 rounded">
                <strong>CORS Notice:</strong> {testResult.corsDetails}
              </p>
            )}
            <p className="text-muted-foreground">
              Tip: If direct browser upload encounters CORS errors, disable &quot;Allow Direct Browser Upload&quot; on the connection to use reliable server-proxied streaming.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Connections List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Configured Connections ({connections.length})</h2>
          <Button size="sm" variant="ghost" onClick={() => refetch()} className="gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {connections.length === 0 ? (
          <Card className="border-dashed p-8 text-center">
            <HardDrive className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
            <h3 className="text-sm font-semibold">No storage connections configured</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Add a Cloudflare R2, AWS S3, or Local storage connection to store and serve product images and assets.
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => openAddModal("r2")} className="mt-4 gap-2">
                <Plus className="h-4 w-4" />
                Add First Connection
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {connections.map((conn) => {
              const isTesting = testingId === conn.id;

              return (
                <Card
                  key={conn.id}
                  className={`flex flex-col justify-between transition-all ${
                    conn.isActive
                      ? "border-primary/60 ring-1 ring-primary/20 shadow-xs"
                      : "border-border/70 hover:border-border"
                  }`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold">{conn.name}</CardTitle>
                          {conn.isActive && (
                            <Badge variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px] uppercase">
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <Badge variant="secondary" className="font-mono text-[11px] uppercase">
                            {conn.driver}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            {conn.purpose === "public_media" ? "Public Media" : "Private Files"}
                          </Badge>
                          <Badge variant="outline" className="text-[11px]">
                            {conn.directBrowserUpload ? "Direct SigV4" : "Server Proxied"}
                          </Badge>
                        </div>
                      </div>

                      {/* Status indicator */}
                      <div>
                        {conn.status === "ok" ? (
                          <div className="flex items-center gap-1 text-emerald-600 text-xs font-medium" title="Connection tested and healthy">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            <span>OK</span>
                          </div>
                        ) : conn.status === "failed" ? (
                          <div className="flex items-center gap-1 text-rose-600 text-xs font-medium" title={conn.lastTestError || "Test failed"}>
                            <XCircle className="h-4 w-4 shrink-0" />
                            <span>Failed</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-muted-foreground text-xs font-medium">
                            <span className="h-2 w-2 rounded-full bg-amber-500" />
                            <span>Untested</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="pb-4 text-xs space-y-2 text-muted-foreground">
                    {conn.driver === "local" ? (
                      <div>
                        <span className="text-foreground/80 font-medium">Local Path:</span>{" "}
                        <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">{conn.localDir || "./.data/media"}</code>
                      </div>
                    ) : (
                      <>
                        <div>
                          <span className="text-foreground/80 font-medium">Bucket:</span>{" "}
                          <span className="text-foreground font-mono">{conn.bucket || "(not set)"}</span>
                        </div>
                        {conn.endpoint && (
                          <div className="truncate">
                            <span className="text-foreground/80 font-medium">Endpoint:</span>{" "}
                            <span className="font-mono text-[11px] truncate">{conn.endpoint}</span>
                          </div>
                        )}
                      </>
                    )}

                    {conn.publicBaseUrl && (
                      <div className="truncate">
                        <span className="text-foreground/80 font-medium">Public Base URL:</span>{" "}
                        <a
                          href={conn.publicBaseUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-0.5 truncate"
                        >
                          {conn.publicBaseUrl}
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      </div>
                    )}

                    <div className="flex items-center gap-3 pt-1 text-[11px]">
                      <span className="flex items-center gap-1 text-foreground/80 font-medium">
                        <KeyRound className="h-3 w-3" />
                        Credentials:
                      </span>
                      {conn.hasAccessKey ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Configured {conn.accessKeyIdLast4 ? `(ending ...${conn.accessKeyIdLast4})` : ""}
                        </span>
                      ) : conn.driver === "local" ? (
                        <span>Not required (local)</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">Not configured</span>
                      )}
                    </div>

                    {conn.lastTestAt && (
                      <div className="text-[11px] text-muted-foreground/80 pt-1">
                        Last tested: {new Date(conn.lastTestAt).toLocaleString()}
                        {conn.lastTestError && (
                          <p className="text-rose-600 dark:text-rose-400 mt-0.5 truncate">{conn.lastTestError}</p>
                        )}
                      </div>
                    )}
                  </CardContent>

                  <CardFooter className="pt-2 border-t border-border/50 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTest(conn)}
                        disabled={isTesting || !canEdit}
                        className="gap-1.5 text-xs h-8"
                      >
                        <RefreshCw className={`h-3 w-3 ${isTesting ? "animate-spin" : ""}`} />
                        {isTesting ? "Testing..." : "Test Connection"}
                      </Button>

                      {!conn.isActive && canEdit && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setActivateTarget(conn)}
                          className="text-xs h-8"
                        >
                          Activate
                        </Button>
                      )}
                    </div>

                    {canEdit && (
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => openEditModal(conn)} className="text-xs h-8">
                          Edit
                        </Button>
                        {!conn.isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(conn)}
                            className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Add / Edit Connection Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Storage Connection" : "Add Storage Connection"}</DialogTitle>
            <DialogDescription>
              Configure storage provider details and API credentials. Credentials are encrypted at rest with AES-256-GCM and never logged or exposed.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="conn-name">Connection Name</Label>
              <Input
                id="conn-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Cloudflare R2 Production"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="conn-driver">Storage Driver</Label>
                <SimpleSelect
                  value={formDriver}
                  onChange={(val: string) => {
                    const d = val as "local" | "r2" | "s3";
                    setFormDriver(d);
                    if (d === "r2") applyR2Preset();
                  }}
                  options={[
                    { value: "r2", label: "Cloudflare R2" },
                    { value: "s3", label: "AWS S3 / S3-Compatible" },
                    { value: "local", label: "Local Filesystem" },
                  ]}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="conn-purpose">Purpose</Label>
                <SimpleSelect
                  value={formPurpose}
                  onChange={(val: string) => setFormPurpose(val as "public_media" | "private_files")}
                  options={[
                    { value: "public_media", label: "Public Media (Catalog & Store)" },
                    { value: "private_files", label: "Private Files (Returns & Exports)" },
                  ]}
                />
              </div>
            </div>

            {formDriver === "local" ? (
              <div className="space-y-3 pt-2 border-t border-border/50">
                <div className="space-y-1.5">
                  <Label htmlFor="conn-local-dir">Directory Path on Server</Label>
                  <Input
                    id="conn-local-dir"
                    value={formLocalDir}
                    onChange={(e) => setFormLocalDir(e.target.value)}
                    placeholder="./.data/media"
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Directory on disk where uploaded media files will be stored. Path traversal attacks are automatically blocked.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conn-public-base-local">Public Base URL (Optional)</Label>
                  <Input
                    id="conn-public-base-local"
                    value={formPublicBaseUrl}
                    onChange={(e) => setFormPublicBaseUrl(e.target.value)}
                    placeholder="e.g. http://localhost:3000 (leave empty for relative /media/...)"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2 border-t border-border/50">
                {formDriver === "r2" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="conn-account-id">Cloudflare Account ID</Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={applyR2Preset}
                        className="h-6 text-[11px] text-primary"
                      >
                        Auto-fill R2 endpoint
                      </Button>
                    </div>
                    <Input
                      id="conn-account-id"
                      value={formAccountId}
                      onChange={(e) => {
                        setFormAccountId(e.target.value);
                        if (e.target.value.trim()) {
                          setFormEndpoint(`https://${e.target.value.trim()}.r2.cloudflarestorage.com`);
                        }
                      }}
                      placeholder="e.g. 5dc9c9ff99a9cfb0583b4b88ae1b033b"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="conn-bucket">Bucket Name</Label>
                    <Input
                      id="conn-bucket"
                      value={formBucket}
                      onChange={(e) => setFormBucket(e.target.value)}
                      placeholder="e.g. bsec-media"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="conn-region">Region</Label>
                    <Input
                      id="conn-region"
                      value={formRegion}
                      onChange={(e) => setFormRegion(e.target.value)}
                      placeholder={formDriver === "r2" ? "auto" : "ap-south-1"}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="conn-endpoint">Endpoint URL</Label>
                  <Input
                    id="conn-endpoint"
                    value={formEndpoint}
                    onChange={(e) => setFormEndpoint(e.target.value)}
                    placeholder={
                      formDriver === "r2"
                        ? "https://<account_id>.r2.cloudflarestorage.com"
                        : "https://s3.ap-south-1.amazonaws.com"
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="conn-public-base">Public Base URL (CDN / Domain)</Label>
                  <Input
                    id="conn-public-base"
                    value={formPublicBaseUrl}
                    onChange={(e) => setFormPublicBaseUrl(e.target.value)}
                    placeholder="e.g. https://media.bcom.si"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The public address of your bucket. Callers use this URL to display images on storefronts.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-3 shadow-2xs">
                  <div className="space-y-0.5">
                    <Label htmlFor="conn-direct-upload" className="text-xs font-semibold">
                      Allow Direct Browser Uploads (SigV4)
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Uploads files directly from the browser to the bucket. Requires bucket CORS to permit PUT from your admin origin. When disabled, all uploads stream safely through the server.
                    </p>
                  </div>
                  <Switch
                    id="conn-direct-upload"
                    checked={formDirectUpload}
                    onCheckedChange={setFormDirectUpload}
                  />
                </div>

                <div className="space-y-3 pt-2 border-t border-border/50">
                  <div className="space-y-1.5">
                    <Label htmlFor="conn-access-key">Access Key ID</Label>
                    <Input
                      id="conn-access-key"
                      value={formAccessKeyId}
                      onChange={(e) => setFormAccessKeyId(e.target.value)}
                      placeholder={editingId ? "Leave blank to keep existing key" : "Access Key ID"}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="conn-secret-key">Secret Access Key</Label>
                    <Input
                      id="conn-secret-key"
                      type="password"
                      value={formSecretAccessKey}
                      onChange={(e) => setFormSecretAccessKey(e.target.value)}
                      placeholder={editingId ? "Leave blank to keep existing secret" : "Secret Access Key"}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Write-only. Stored encrypted with AES-256-GCM.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="pt-3">
              <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : editingId ? "Save Changes" : "Create Connection"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation: Activate Target */}
      <ConfirmDialog
        open={Boolean(activateTarget)}
        onOpenChange={(open) => {
          if (!open) setActivateTarget(null);
        }}
        title={`Activate "${activateTarget?.name}"?`}
        description={
          activateTarget
            ? `This will make "${activateTarget.name}" the primary active driver for ${
                activateTarget.purpose === "public_media" ? "Public Media" : "Private Files"
              }. Newly uploaded images will be stored in this connection. Existing media files remain valid.`
            : ""
        }
        confirmLabel={activating ? "Activating..." : "Activate Connection"}
        onConfirm={handleActivate}
      />

      {/* Confirmation: Delete Target */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete "${deleteTarget?.name}"?`}
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone. If any media records reference this connection, deletion will be refused.`
            : ""
        }
        confirmLabel={deleting ? "Deleting..." : "Delete Connection"}
        destructive
        onConfirm={handleDelete}
      />
    </PageContainer>
  );
}
