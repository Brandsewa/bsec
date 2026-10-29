import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export interface ScrollTabsProps {
  value: string;
  onChange: (value: string) => void;
  tabs: ReadonlyArray<{ id: string; label: string; /** Small number shown next to the label. */ count?: number | undefined }>;
}

/** Saved-view tabs: one line, scrolls sideways on phones instead of wrapping. */
export function ScrollTabs({
  value,
  onChange,
  tabs,
}: ScrollTabsProps) {
  return (
    <Tabs className="min-w-0" value={value} onValueChange={onChange}>
      <TabsList variant="line" className="h-auto w-full flex-nowrap justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="flex-none px-3 whitespace-nowrap">
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-muted-foreground">{t.count}</span> : null}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

