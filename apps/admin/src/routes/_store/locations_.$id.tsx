import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, CheckCircle2, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Location } from "@bs/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "../../components/confirm-dialog.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/locations_/$id")({
  pendingComponent: () => <PageSkeleton />,
  component: EditLocationRoute,
});

function EditLocationRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return <EditLocationPage id={id} navigate={(to) => void navigate({ to })} />;
}

export function EditLocationPage({ id, navigate }: { id: string; navigate?: (to: string) => void }) {
  const go = navigate ?? (() => undefined);
  const locationQuery = useQuery(orpc.admin.locations.get.queryOptions({ input: { id } }));

  if (locationQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (locationQuery.isError || !locationQuery.data) {
    return (
      <PageContainer size="default" className="space-y-6">
        <PageBreadcrumbs items={[{ label: "Locations", href: "/locations" }, { label: "Not found" }]} />
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Location not found or deleted.</p>
            <Button className="mt-4" onClick={() => go("/locations")}>
              Back to locations
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return <LocationEditor key={locationQuery.data.id} location={locationQuery.data} go={go} />;
}

function LocationEditor({ location, go }: { location: Location; go: (to: string) => void }) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(location.name);
  const [line1, setLine1] = useState(location.address?.line1 ?? "");
  const [line2, setLine2] = useState(location.address?.line2 ?? "");
  const [city, setCity] = useState(location.address?.city ?? "");
  const [state, setState] = useState(location.address?.stateCode ?? "");
  const [pincode, setPincode] = useState(location.pincode ?? "");
  const [isActive, setIsActive] = useState(location.isActive);
  const [isDefault, setIsDefault] = useState(location.isDefault);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);

  const updateMutation = useMutation(
    orpc.admin.locations.update.mutationOptions({
      onSuccess: (loc) => {
        toast.success(`Location updated: ${loc.name}`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.get.key({ input: { id: location.id } }) });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.stats.key() });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to update location"));
      },
    }),
  );

  const deleteMutation = useMutation(
    orpc.admin.locations.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Location deleted");
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.stats.key() });
        go("/locations");
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to delete location"));
      },
    }),
  );

  const handleSave = () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Location name is required";
    if (!line1.trim()) errs.line1 = "Address line 1 is required";
    if (!city.trim()) errs.city = "City is required";
    if (!state.trim()) errs.state = "State is required";
    if (!pincode.trim()) errs.pincode = "PIN code is required";
    else if (!/^\d{6}$/.test(pincode.trim())) errs.pincode = "Indian PIN code must be 6 digits";

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    updateMutation.mutate({
      id: location.id,
      name: name.trim(),
      address: {
        line1: line1.trim(),
        line2: line2.trim() || undefined,
        city: city.trim(),
        stateCode: state.trim(),
        countryCode: "IN",
      },
      pincode: pincode.trim(),
      isActive,
      isDefault,
    });
  };

  return (
    <PageContainer size="default" className="space-y-6 pb-16">
      <PageBreadcrumbs
        items={[
          { label: "Locations", href: "/locations" },
          { label: location.name },
        ]}
      />

      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <span>{location.name}</span>
            {location.isDefault && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                Default Origin
              </Badge>
            )}
          </div>
        }
        description={`Location ID: ${location.id}`}
        aside={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => go("/locations")}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
            {!location.isDefault && (
              <Button variant="outline" onClick={() => setDeleteOpen(true)} className="text-destructive">
                <Trash2 className="mr-1.5 h-4 w-4" />
                Delete
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" />
              {updateMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Location Details</CardTitle>
              <CardDescription>Address and postal code for inventory storage and courier pickups.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field>
                <FieldLabel htmlFor="loc-name">Location Name</FieldLabel>
                <Input
                  id="loc-name"
                  placeholder="e.g. Primary Warehouse / Mumbai Hub"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              </Field>

              <Field>
                <FieldLabel htmlFor="loc-line1">Address Line 1</FieldLabel>
                <Input
                  id="loc-line1"
                  placeholder="Plot/Building, Street name"
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                />
                {errors.line1 && <p className="text-xs text-destructive">{errors.line1}</p>}
              </Field>

              <Field>
                <FieldLabel htmlFor="loc-line2">Address Line 2 (Optional)</FieldLabel>
                <Input
                  id="loc-line2"
                  placeholder="Landmark, Area, Industrial Estate"
                  value={line2}
                  onChange={(e) => setLine2(e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="loc-city">City</FieldLabel>
                  <Input
                    id="loc-city"
                    placeholder="e.g. Mumbai"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                  {errors.city && <p className="text-xs text-destructive">{errors.city}</p>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="loc-state">State</FieldLabel>
                  <Input
                    id="loc-state"
                    placeholder="e.g. Maharashtra"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  />
                  {errors.state && <p className="text-xs text-destructive">{errors.state}</p>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="loc-pincode">PIN Code (6 digits)</FieldLabel>
                  <Input
                    id="loc-pincode"
                    placeholder="400001"
                    maxLength={6}
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                  />
                  {errors.pincode && <p className="text-xs text-destructive">{errors.pincode}</p>}
                </Field>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Settings & Status</CardTitle>
              <CardDescription>Manage fulfillment availability and default routing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Active</div>
                  <div className="text-xs text-muted-foreground">
                    {location.isDefault
                      ? "The default location cannot be deactivated."
                      : "Allow inventory tracking & fulfillment."}
                  </div>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  disabled={location.isDefault}
                />
              </div>

              <div className="flex items-center justify-between border-t pt-4">
                <div>
                  <div className="text-sm font-medium">Default Location</div>
                  <div className="text-xs text-muted-foreground">
                    {isDefault
                      ? "This is your primary shipping location."
                      : "Set as primary shipping origin for your store."}
                  </div>
                </div>
                <Switch
                  checked={isDefault}
                  onCheckedChange={(val) => {
                    if (!val && location.isDefault) {
                      toast.error("Set another location as default instead.");
                      return;
                    }
                    setIsDefault(val);
                  }}
                  disabled={location.isDefault}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete location"
        description={
          <span>
            Are you sure you want to delete <strong>{location.name}</strong>?
            <span className="mt-2 block text-muted-foreground">
              Locations with stock on hand cannot be deleted. If this location holds inventory, deactivate it instead.
            </span>
          </span>
        }
        confirmLabel="Delete location"
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate({ id: location.id })}
      />
    </PageContainer>
  );
}
