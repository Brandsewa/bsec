export { cn } from "./lib/cn.ts";
export { UiLink, UiLinkProvider, type UiLinkProps } from "./lib/link.tsx";

// shadcn UI primitives (Base UI flavored)
export { Button, buttonVariants, type ButtonProps } from "./components/ui/button.tsx";
export { Input, type InputProps } from "./components/ui/input.tsx";
export { Textarea, type TextareaProps } from "./components/ui/textarea.tsx";
export { Label } from "./components/ui/label.tsx";
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from "./components/ui/card.tsx";
export { Badge, badgeVariants } from "./components/ui/badge.tsx";
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

// Composed shared components
export { ConfirmDialog, type ConfirmDialogProps } from "./components/confirm-dialog.tsx";
export { SimpleSelect, type SimpleSelectProps, type SelectOption } from "./components/simple-select.tsx";
export { DateRangePicker, type DateRangePickerProps } from "./components/date-range-picker.tsx";
export { DatePicker, type DatePickerProps } from "./components/date-picker.tsx";
export { ScrollTabs, type ScrollTabsProps } from "./components/scroll-tabs.tsx";
export { SectionCard, type SectionCardProps } from "./components/section-card.tsx";
export { InfoTip, type InfoTipProps } from "./components/info-tip.tsx";
export { ImageUploader, type ImageUploaderProps, type UploadAdapter } from "./components/image-uploader.tsx";

// Legacy components maintained for backwards compatibility
export { Select as LegacySelect } from "./components/select.tsx";
export { Form, FormField, FormItemLayout } from "./components/form.tsx";
export { EmptyState } from "./components/empty-state.tsx";
export { DetailSkeleton, FormSkeleton, MetricCardSkeleton, TableSkeleton } from "./components/skeleton.tsx";
export { Toaster, toast } from "./components/toast.tsx";
export { PageBreadcrumbs, PageContainer, PageHeader, PageSection, type Crumb } from "./layout/page.tsx";
export { AppShell, type NavGroup, type NavItem } from "./layout/sidebar.tsx";
export { PageSkeleton, ROUTE_PENDING_MIN_MS, ROUTE_PENDING_MS } from "./patterns/route-template.tsx";
export { MetricCard, type MetricCardProps } from "./patterns/metric-card.tsx";
export { FilterBar, type FilterBarProps } from "./patterns/filter-bar.tsx";
export { DataTable, type ColumnDef, type DataTableProps } from "./patterns/data-table.tsx";

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
} from "./theme/index.ts";
