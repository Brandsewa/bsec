"use client";

import * as React from "react";
import { Check, X, ChevronsUpDown } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/badge.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  maxDisplay?: number;
  disabled?: boolean;
  className?: string;
}

export function MultiSelect({
  options,
  value = [],
  onChange,
  placeholder = "Select options...",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  maxDisplay = 3,
  disabled = false,
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const toggleOption = (val: string) => {
    if (value.includes(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
    }
  };

  const removeOption = (e: React.MouseEvent, val: string) => {
    e.stopPropagation();
    onChange(value.filter((v) => v !== val));
  };

  const selectedOptions = options.filter((opt) => value.includes(opt.value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "flex min-h-8 w-full items-center justify-between rounded-[var(--radius-button)] border border-[var(--border)] bg-transparent px-2.5 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <div className="flex flex-wrap gap-1 items-center">
          {selectedOptions.length === 0 && (
            <span className="text-[var(--muted-foreground)]">{placeholder}</span>
          )}
          {selectedOptions.slice(0, maxDisplay).map((opt) => (
            <Badge
              key={opt.value}
              variant="secondary"
              className="h-5 px-1.5 text-[11px] font-normal gap-1 rounded-[var(--radius-button)]"
            >
              <span>{opt.label}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => removeOption(e, opt.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    removeOption(e as unknown as React.MouseEvent, opt.value);
                  }
                }}
                className="cursor-pointer hover:text-[var(--destructive)]"
              >
                <X className="h-2.5 w-2.5" />
              </span>
            </Badge>
          ))}
          {selectedOptions.length > maxDisplay && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal rounded-[var(--radius-button)]">
              +{selectedOptions.length - maxDisplay} more
            </Badge>
          )}
        </div>
        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => toggleOption(option.value)}
                    className="text-xs"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {option.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
