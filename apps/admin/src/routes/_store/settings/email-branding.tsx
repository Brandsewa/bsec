import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmailBrandingEditor, PageSkeleton, toast, type EmailBrandingValue } from "@bs/ui";
import { SettingsPageFrame } from "../../../components/settings/settings-page.tsx";
import { client } from "../../../lib/orpc.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const Route = createFileRoute("/_store/settings/email-branding")({
  pendingComponent: () => <PageSkeleton />,
  component: EmailBrandingPage,
});

function EmailBrandingPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["admin", "notifications", "branding"], queryFn: () => client.admin.notifications.branding() });
  const [value, setValue] = useState<EmailBrandingValue | null>(null);
  const [html, setHtml] = useState("");
  const [issues, setIssues] = useState<Array<{ field: string; message: string }>>([]);
  const seeded = useRef(false);

  useEffect(() => {
    if (query.data && !seeded.current) {
      seeded.current = true;
      setValue(query.data.tokens);
    }
  }, [query.data]);

  // Debounced live preview, rendered by the server with the same layout real emails use.
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => {
      client.admin.notifications
        .previewBranding({ ...value })
        .then((r) => {
          setHtml(r.html);
          setIssues(r.issues);
        })
        .catch(() => undefined);
    }, 350);
    return () => clearTimeout(t);
  }, [value]);

  const save = useMutation({
    mutationFn: (v: EmailBrandingValue) => client.admin.notifications.updateBranding({ ...v }),
    onSuccess: async (r) => {
      setIssues(r.issues);
      toast.success(r.issues.length > 0 ? "Saved; some values were adjusted for readability" : "Email branding saved");
      await qc.invalidateQueries({ queryKey: ["admin", "notifications", "branding"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const dirty = useMemo(() => JSON.stringify(value) !== JSON.stringify(query.data?.tokens), [value, query.data]);

  return (
    <SettingsPageFrame width="wide" title="Email branding" description="Your logo, colours and footer on the emails your customers receive. The wording of each email is set by the platform.">
      {!value ? (
        <PageSkeleton />
      ) : (
        <EmailBrandingEditor
          value={value}
          onChange={setValue}
          previewHtml={html}
          issues={issues}
          showTypography={false}
          dirty={dirty}
          saving={save.isPending}
          onSave={() => save.mutate(value)}
          audienceNote="Order, shipping, return and account emails to your customers use these. Fonts follow the platform style."
        />
      )}
    </SettingsPageFrame>
  );
}
