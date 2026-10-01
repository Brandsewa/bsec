import { useMutation } from "@tanstack/react-query";
import { orpc } from "./orpc.ts";
import { saveTextFile } from "./download-csv.ts";

/** Button handler for "Export": asks the server for the store's CSV and saves it. */
export function useCsvExport(kind: "orders" | "customers" | "products") {
  const m = useMutation(
    orpc.admin.exports.csv.mutationOptions({
      onSuccess: (r) => saveTextFile(r.filename, r.csv),
    }),
  );
  return { run: () => m.mutate({ kind }), pending: m.isPending, error: m.error?.message ?? null };
}
