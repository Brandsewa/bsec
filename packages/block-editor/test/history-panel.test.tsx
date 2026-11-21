import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryPanelContext, HistoryPanelFromContext, formatVersionTime, type HistoryHost, type HistoryPanelState } from "../src/HistoryPanel.tsx";

const host = (over: Partial<HistoryHost> = {}): HistoryHost => ({
  list: async () => [],
  read: async () => [],
  restore: async () => {},
  canRestore: true,
  ...over,
});

const state = (over: Partial<HistoryPanelState> = {}): HistoryPanelState => ({
  host: host(),
  dirty: false,
  previewingId: null,
  preview: () => {},
  exitPreview: () => {},
  ...over,
});

const render = (s: HistoryPanelState | null) =>
  renderToStaticMarkup(
    <HistoryPanelContext.Provider value={s}>
      <HistoryPanelFromContext />
    </HistoryPanelContext.Provider>,
  );

describe("History panel", () => {
  it("renders nothing without editor state", () => {
    expect(render(null)).toBe("");
  });

  it("explains that nothing changes until a restore and starts in the loading state", () => {
    const html = render(state());
    expect(html).toContain("nothing changes until you restore it");
    expect(html).toContain("Loading...");
    expect(html).not.toContain("Previewing");
  });

  it("while previewing, says saving is off and offers restore only to people who may restore", () => {
    const withRestore = render(state({ previewingId: "v1" }));
    expect(withRestore).toContain("Saving and publishing are switched off while you preview.");
    expect(withRestore).toContain("Restore this version");
    expect(withRestore).toContain("Back to current");

    const readOnly = render(state({ previewingId: "v1", host: host({ canRestore: false }) }));
    expect(readOnly).not.toContain("Restore this version");
    expect(readOnly).toContain("You can look at versions but not restore them.");
    expect(readOnly).toContain("Back to current");
  });

  it("formats times and leaves an unreadable value as it is", () => {
    expect(formatVersionTime("2026-11-16T07:05:04.091Z")).toMatch(/2026/);
    expect(formatVersionTime("not a date")).toBe("not a date");
  });
});
