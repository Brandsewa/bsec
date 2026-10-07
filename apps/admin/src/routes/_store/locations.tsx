import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, MapPin, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { MetricCard, MetricCardSkeleton, PageContainer, PageHeader, PageSection, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Location } from "@bs/contracts";
import { Badge } from "@bs/ui";
import { Button } from "@bs/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@bs/ui";
import { ConfirmDialog } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/locations")({
  pendingComponent: () => <PageSkeleton />,
  component: LocationsPage,
});

export function LocationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);

  const statsQuery = useQuery(orpc.admin.locations.stats.queryOptions());
  const locationsQuery = useQuery(orpc.admin.locations.list.queryOptions());

  const locations = locationsQuery.data ?? [];

  const deleteMutation = useMutation(
    orpc.admin.locations.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Location deleted");
        setDeleteTarget(null);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Could not delete location"));
      },
    }),
  );

  return (
    <PageContainer size="full">
      <PageHeader
        title="Locations"
        description="Manage physical stock locations, warehouses, and fulfillment origins."
        aside={
          <Button onClick={() => void navigate({ to: "/locations/new" })} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Add location
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3">
        {statsQuery.isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Total Locations" value={statsQuery.data?.total ?? 0} />
            <MetricCard label="Active Locations" value={statsQuery.data?.active ?? 0} />
            <MetricCard label="Inactive Locations" value={statsQuery.data?.inactive ?? 0} />
          </>
        )}
      </div>

      <PageSection>
        {/* Locations Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Location Name</th>
                <th className="px-4 py-3">Address & PIN</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Default</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
            {locationsQuery.isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading locations...
                </td>
              </tr>
            ) : locations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <MapPin className="h-8 w-8 text-muted-foreground/60" />
                    <p className="text-sm font-medium">No locations found</p>
                    <p className="text-xs text-muted-foreground">Add your store warehouse or fulfillment center.</p>
                    <Button
                      size="sm"
                      onClick={() => void navigate({ to: "/locations/new" })}
                      className="mt-2 gap-1.5"
                    >
                      <Plus className="h-4 w-4" />
                      Add location
                    </Button>
                  </div>
                </td>
              </tr>
            ) : (
              locations.map((loc) => (
                <tr key={loc.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div className="flex items-center gap-2">
                      <Link
                        to="/locations/$id"
                        params={{ id: loc.id }}
                        className="hover:underline"
                      >
                        {loc.name}
                      </Link>
                      {loc.isDefault && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          Default Origin
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {loc.address ? (
                      <>
                        <div>
                          {loc.address.line1}
                          {loc.address.line2 ? `, ${loc.address.line2}` : ""}
                        </div>
                        <div>
                          {[loc.address.city, loc.address.stateCode].filter(Boolean).join(", ")}
                          {loc.pincode ? ` - ${loc.pincode}` : ""}
                        </div>
                      </>
                    ) : (
                      <span>{loc.pincode ? `PIN: ${loc.pincode}` : "No address specified"}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={loc.isActive ? "default" : "outline"} className="text-xs">
                      {loc.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {loc.isDefault ? "Primary shipping origin" : "Secondary warehouse"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon-sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => void navigate({ to: "/locations/$id", params: { id: loc.id } })}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        {!loc.isDefault && (
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(loc)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </PageSection>

      {/* Delete Location Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete location"
        description={
          deleteTarget ? (
            <span>
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
              <span className="mt-2 block text-muted-foreground">
                Locations with stock on hand cannot be deleted. If this location holds inventory, deactivate it instead.
              </span>
            </span>
          ) : ""
        }
        confirmLabel="Delete location"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
          }
        }}
      />
    </PageContainer>
  );
}
