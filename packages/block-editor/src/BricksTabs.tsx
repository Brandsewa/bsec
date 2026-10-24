import { useSyncExternalStore } from "react";
import { AutoField, FieldLabel, type CustomField, type Field } from "@puckeditor/core";
import type { LayoutDevice } from "@bs/blocks";

const openState = new Map<string, string>(); // blockType -> active tab/group id
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

let activeBricksDevice: LayoutDevice = "desktop";

export function setBricksActiveDevice(device: LayoutDevice) {
  activeBricksDevice = device;
  listeners.forEach((l) => l());
}

export function useBricksActiveDevice(): LayoutDevice {
  return useSyncExternalStore(
    subscribe,
    () => activeBricksDevice,
    () => "desktop" as LayoutDevice
  );
}

export function setBricksActiveTab(blockType: string, tabId: string) {
  openState.set(`${blockType}:tab`, tabId);
  listeners.forEach((l) => l());
}

export function useBricksActiveTab(blockType: string, defaultTab: string = "content") {
  return useSyncExternalStore(
    subscribe,
    () => openState.get(`${blockType}:tab`) || defaultTab,
    () => defaultTab
  );
}

export function toggleBricksGroup(blockType: string, groupId: string) {
  const activeKey = `${blockType}:activeGroup`;
  const current = openState.get(activeKey);
  if (current === groupId) {
    openState.delete(activeKey); // close if clicking currently open
  } else {
    openState.set(activeKey, groupId); // open selected, automatically closing others
  }
  listeners.forEach((l) => l());
}

export function useBricksGroupOpen(blockType: string, groupId: string, defaultOpen: boolean = false) {
  return useSyncExternalStore(
    subscribe,
    () => {
      const active = openState.get(`${blockType}:activeGroup`);
      if (active === undefined) return defaultOpen;
      return active === groupId;
    },
    () => defaultOpen
  );
}

export const BRICKS_TAB_HEADER_KEY = "__bricks_tabs_header__";
export const BRICKS_GROUP_PREFIX = "__bricks_group_";

export function BricksTabsHeader({
  blockType,
  tabs,
}: {
  blockType: string;
  tabs: { id: string; label: string; icon: React.ReactNode }[];
}) {
  const activeTab = useBricksActiveTab(blockType, tabs[0]?.id);
  const activeDevice = useBricksActiveDevice();

  return (
    <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
      {/* 1. Main Tabs: Content | Style */}
      <div
        style={{
          display: "flex",
          background: "#f4f4f5",
          borderRadius: 6,
          padding: 3,
          border: "1px solid #e4e4e7",
          overflow: "hidden",
          gap: 2,
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setBricksActiveTab(blockType, tab.id)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                height: 32,
                border: 0,
                borderRadius: 5,
                background: isActive ? "#ffffff" : "transparent",
                color: isActive ? "#18181b" : "#71717a",
                boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Responsive Device Switcher: Desktop | Tablet | Mobile */}
      <div
        role="tablist"
        aria-label="Responsive Device Mode"
        style={{
          display: "flex",
          background: "#f0f0f3",
          borderRadius: 6,
          padding: 2,
          gap: 2,
          alignItems: "center",
        }}
      >
        {[
          {
            id: "desktop" as const,
            label: "Desktop",
            icon: (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            ),
          },
          {
            id: "tablet" as const,
            label: "Tablet",
            icon: (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            ),
          },
          {
            id: "mobile" as const,
            label: "Mobile",
            icon: (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            ),
          },
        ].map((d) => {
          const isActive = activeDevice === d.id;
          return (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={`Configure for ${d.label}`}
              onClick={() => setBricksActiveDevice(d.id)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                height: 26,
                border: 0,
                borderRadius: 4,
                background: isActive ? "#ffffff" : "transparent",
                color: isActive ? "#18181b" : "#71717a",
                boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                fontSize: 11,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ display: "flex", alignItems: "center" }}>{d.icon}</span>
              <span>{d.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BricksGroupHeader({
  blockType,
  groupId,
  title,
  icon,
}: {
  blockType: string;
  groupId: string;
  title: string;
  icon: React.ReactNode;
}) {
  const isOpen = useBricksGroupOpen(blockType, groupId, groupId === "layout");

  return (
    <div
      style={{
        marginTop: 6,
        marginBottom: isOpen ? 6 : 0,
        borderRadius: 6,
        background: isOpen ? "#f4f4f5" : "#fafafa",
        border: "1px solid #e4e4e7",
        overflow: "hidden",
        transition: "background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s ease, margin 0.18s ease",
      }}
    >
      <button
        type="button"
        onClick={() => toggleBricksGroup(blockType, groupId)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          padding: "8px 10px",
          border: 0,
          background: "transparent",
          color: isOpen ? "#18181b" : "#52525b",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
          transition: "color 0.15s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: isOpen ? "#18181b" : "#71717a", display: "flex", alignItems: "center", transition: "color 0.15s ease" }}>
            {icon}
          </span>
          <span>{title}</span>
        </div>
        <span
          style={{
            fontSize: 10,
            color: isOpen ? "#18181b" : "#71717a",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), color 0.15s ease",
            display: "inline-block",
          }}
        >
          ▼
        </span>
      </button>
    </div>
  );
}

export function BricksFieldGate({
  blockType,
  tab,
  group,
  children,
}: {
  blockType: string;
  tab: string;
  group?: string | undefined;
  children: React.ReactNode;
}) {
  const activeTab = useBricksActiveTab(blockType);
  const isGroupOpen = useBricksGroupOpen(blockType, group || "", group === "layout");

  const isVisible = activeTab === tab && (!group || isGroupOpen);

  if (!isVisible) {
    return <span data-sec-closed="" hidden />;
  }

  return (
    <div
      data-sec-field=""
      style={{
        animation: "bricksAccordionFade 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      {children}
    </div>
  );
}
