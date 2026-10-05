import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save } from "lucide-react";
import { useState } from "react";
import { PageBreadcrumbs, PageContainer, PageHeader, PageSkeleton, toast } from "@bs/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bs/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@bs/ui";
import { Field, FieldLabel } from "@bs/ui";
import { Input } from "@bs/ui";
import { Switch } from "@bs/ui";
import { errorMessage } from "../../lib/errors.ts";
import { orpc } from "../../lib/orpc.ts";

export const Route = createFileRoute("/_store/locations_/new")({
  pendingComponent: () => <PageSkeleton />,
  component: CreateLocationPage,
});

export function CreateLocationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useMutation(
    orpc.admin.locations.create.mutationOptions({
      onSuccess: (loc) => {
        toast.success(`Location created: ${loc.name}`);
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.list.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.admin.locations.stats.key() });
        void navigate({ to: "/locations" });
      },
      onError: (err) => {
        toast.error(errorMessage(err, "Failed to create location"));
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

    createMutation.mutate({
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
          { label: "New location" },
        ]}
      />

      <PageHeader
        title="Add location"
        description="Add a physical warehouse, retail shop, or dispatch facility."
        aside={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void navigate({ to: "/locations" })}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending}
              className="gap-1.5"
            >
              <Save className="h-4 w-4" />
              {createMutation.isPending ? "Saving..." : "Save location"}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Location Details</CardTitle>
              <CardDescription>Give this location a recognizable name and address.</CardDescription>
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
                  <div className="text-xs text-muted-foreground">Allow inventory tracking & fulfillment from here.</div>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>

              <div className="flex items-center justify-between border-t pt-4">
                <div>
                  <div className="text-sm font-medium">Default Location</div>
                  <div className="text-xs text-muted-foreground">Primary origin for shipping & new inventory.</div>
                </div>
                <Switch checked={isDefault} onCheckedChange={setIsDefault} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
