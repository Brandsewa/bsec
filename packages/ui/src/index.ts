export { cn } from "./lib/cn.ts";
export { UiLink, UiLinkProvider, type UiLinkProps } from "./lib/link.tsx";

// shadcn UI primitives (Base UI flavored)
export { Button, buttonVariants, type ButtonProps } from "./components/ui/button.tsx";
export { Input, type InputProps } from "./components/ui/input.tsx";
export { Textarea, type TextareaProps } from "./components/ui/textarea.tsx";
export { Label } from "./components/ui/label.tsx";
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./components/ui/card.tsx";
export { Badge, badgeVariants } from "./components/ui/badge.tsx";
export { Avatar, AvatarImage, AvatarFallback } from "./components/ui/avatar.tsx";
export { Alert, AlertTitle, AlertDescription } from "./components/ui/alert.tsx";
export { Separator } from "./components/ui/separator.tsx";
export { Switch } from "./components/ui/switch.tsx";
export { Checkbox } from "./components/ui/checkbox.tsx";
export { RadioGroup, RadioGroupItem } from "./components/ui/radio-group.tsx";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs.tsx";
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "./components/ui/dialog.tsx";
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "./components/ui/sheet.tsx";
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./components/ui/popover.tsx";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "./components/ui/dropdown-menu.tsx";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "./components/ui/select.tsx";
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "./components/ui/table.tsx";
export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
} from "./components/ui/field.tsx";
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./components/ui/sidebar.tsx";
export { Progress } from "./components/ui/progress.tsx";
export { Skeleton } from "./components/ui/skeleton.tsx";
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./components/ui/tooltip.tsx";
export { Toaster as SonnerToaster } from "./components/ui/sonner.tsx";
export { Calendar } from "./components/ui/calendar.tsx";

// New primitives & Base UI components
export { Drawer, DrawerTrigger, DrawerPortal, DrawerClose, DrawerOverlay, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription } from "./components/ui/drawer.tsx";
export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator } from "./components/ui/command.tsx";
export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle } from "./components/ui/chart.tsx";
export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from "./components/ui/input-otp.tsx";

// Composed shared components
export { ConfirmDialog, type ConfirmDialogProps } from "./components/confirm-dialog.tsx";
export { SimpleSelect, type SimpleSelectProps, type SelectOption } from "./components/simple-select.tsx";
export { DateRangePicker, type DateRangePickerProps } from "./components/date-range-picker.tsx";
export { DatePicker, type DatePickerProps } from "./components/date-picker.tsx";
export { DateTimePicker, type DateTimePickerProps } from "./components/date-time-picker.tsx";
export { ScrollTabs, type ScrollTabsProps } from "./components/scroll-tabs.tsx";
export { SectionCard, type SectionCardProps } from "./components/section-card.tsx";
export { InfoTip, type InfoTipProps } from "./components/info-tip.tsx";
export { ImageUploader, type ImageUploaderProps, type UploadAdapter } from "./components/image-uploader.tsx";
export { Combobox, type ComboboxProps, type ComboboxOption } from "./components/combobox.tsx";
export { MultiSelect, type MultiSelectProps, type MultiSelectOption } from "./components/multi-select.tsx";
export { CommandPalette, type CommandPaletteProps, type CommandPaletteAction } from "./components/command-palette.tsx";
export { ResponsiveDialog, ResponsiveDialogTrigger, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter, ResponsiveDialogClose, type ResponsiveDialogProps } from "./components/responsive-dialog.tsx";
export { Spinner, Empty, type SpinnerProps, type EmptyProps } from "./components/spinner.tsx";
export { RouteProgress, type RouteProgressProps } from "./components/route-progress.tsx";
export { StatusBadge, Money, RelativeTime, type StatusBadgeProps, type StatusTone, type MoneyProps, type RelativeTimeProps } from "./components/status-parts.tsx";
export { AuthShell, type AuthShellProps } from "./layout/auth-shell.tsx";

// Skeletons
export {
  PageHeaderSkeleton,
  MetricCardsSkeleton,
  DataTableSkeleton,
  FormSectionSkeleton,
  DetailPageSkeleton,
  AuthCardSkeleton,
  AccountPageSkeleton,
} from "./patterns/skeletons.tsx";

// Shared DataTable Kit
export {
  DataTable as SharedDataTable,
  type Column as SharedColumn,
  type DataTableProps as SharedDataTableProps,
} from "./components/data-table/data-table.tsx";
export { Pagination, PAGE_SIZES } from "./components/data-table/pagination.tsx";
export { TableToolbar, type SortOption } from "./components/data-table/table-toolbar.tsx";
export { BulkBar, ColumnsMenu, FilterChips, type FilterChip } from "./components/data-table/toolbar-parts.tsx";
export { useBulkRunner, type BulkProgress } from "./components/data-table/use-bulk-runner.ts";
export { useTableSelection } from "./components/data-table/use-table-selection.ts";
export {
  useUrlTableState,
  useDebouncedValue,
  useColumnVisibility,
  parsePaging,
  compactSearch,
  oneOf,
  text,
  day,
  flag,
  dayStartIso,
  dayAfterIso,
  SearchStateProvider,
  type SearchStateAdapter,
} from "./components/data-table/use-table-state.ts";
export { fetchAllPages } from "./components/data-table/fetch-all.ts";

// Legacy components maintained for backwards compatibility
export { Form, FormField, FormItemLayout } from "./components/form.tsx";
export { EmptyState } from "./components/empty-state.tsx";
export { DetailSkeleton, FormSkeleton, MetricCardSkeleton, TableSkeleton } from "./components/skeleton.tsx";
export { Toaster, toast } from "./components/toast.tsx";
export { PageBreadcrumbs, PageContainer, PageHeader, PageSection, type Crumb } from "./layout/page.tsx";
export { AppShell, type NavGroup, type NavItem } from "./layout/sidebar.tsx";
export { PageSkeleton, ROUTE_PENDING_MIN_MS, ROUTE_PENDING_MS } from "./patterns/route-template.tsx";
export { MetricCard, type MetricCardProps } from "./patterns/metric-card.tsx";
export { FilterBar, type FilterBarProps } from "./patterns/filter-bar.tsx";

// Theme exports
export {
  THEME_STORAGE_KEY,
  themeBootScript,
  ThemeProvider,
  useTheme,
  ThemeToggle,
  type ThemePreference,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemeToggleProps,
  deriveAccent,
  type DerivedAccent,
} from "./theme/index.ts";

