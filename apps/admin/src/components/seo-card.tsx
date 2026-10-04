import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface SeoCardProps {
  /** The fallback title when title is empty (usually product / category / collection name) */
  defaultTitle: string;
  /** The fallback description when description is empty */
  defaultDescription?: string | undefined;
  /** The prefix path, e.g. "/categories", "/collections", "/products" */
  pathPrefix: string;
  /** The current slug or handle */
  slug: string;
  onSlugChange?: ((slug: string) => void) | undefined;
  title: string;
  onTitleChange: (title: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  /** Optional extra controls placed below (e.g. indexable switch for collections) */
  children?: ReactNode;
}

export function SeoCard({
  defaultTitle,
  defaultDescription = "",
  pathPrefix,
  slug,
  onSlugChange,
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  children,
}: SeoCardProps) {
  const previewTitle = title.trim() || defaultTitle || "Untitled Page";
  const previewDescription =
    description.trim() ||
    defaultDescription ||
    "Add a search engine description to see how this page might appear in search engine results.";
  const previewUrl = `https://your-store.bcom.si${pathPrefix}/${slug || "handle"}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          Search engine listing
        </CardTitle>
        <CardDescription>
          Preview and customize how this page appears in Google and other search results.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {/* Google-style search snippet preview */}
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="text-xs text-muted-foreground truncate">{previewUrl}</div>
          <div className="mt-1 text-base font-medium text-blue-600 hover:underline dark:text-blue-400 line-clamp-1">
            {previewTitle}
          </div>
          <div className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
            {previewDescription}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="seo-title">Page title</FieldLabel>
              <span
                className={`text-xs ${
                  title.length > 70 ? "font-semibold text-destructive" : "text-muted-foreground"
                }`}
              >
                {title.length} / 70 characters
              </span>
            </div>
            <Input
              id="seo-title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={defaultTitle || "Leave blank for default title"}
              maxLength={100}
            />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="seo-description">Meta description</FieldLabel>
              <span
                className={`text-xs ${
                  description.length > 160 ? "font-semibold text-destructive" : "text-muted-foreground"
                }`}
              >
                {description.length} / 160 characters
              </span>
            </div>
            <Textarea
              id="seo-description"
              rows={3}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder={defaultDescription || "Leave blank for auto-generated summary"}
              maxLength={320}
            />
          </div>

          {onSlugChange && (
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="seo-slug">URL Handle</FieldLabel>
              <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
                <span className="select-none pl-3 text-xs text-muted-foreground">{pathPrefix}/</span>
                <input
                  id="seo-slug"
                  type="text"
                  value={slug}
                  onChange={(e) => onSlugChange(e.target.value)}
                  className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="custom-url-handle"
                />
              </div>
            </div>
          )}
        </div>

        {children}
      </CardContent>
    </Card>
  );
}
