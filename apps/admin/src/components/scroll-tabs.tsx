import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Saved-view tabs: one line, scrolls sideways on phones instead of wrapping. */
export function ScrollTabs({
  value,
  onChange,
  tabs,
}: {
  value: string;
  onChange: (value: string) => void;
  tabs: ReadonlyArray<{ id: string; label: string }>;
}) {
  return (
    <Tabs className="min-w-0" value={value} onValueChange={onChange}>
      <TabsList variant="line" className="h-auto w-full flex-nowrap justify-start overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="flex-none px-3 whitespace-nowrap">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
