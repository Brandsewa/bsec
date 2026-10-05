"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Calendar } from "./ui/calendar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { cn } from "../lib/cn.ts";

export interface DatePickerProps {
  value?: Date | undefined;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
}: DatePickerProps) {
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-start text-left font-normal h-8 px-3 rounded-[var(--radius-button)] border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] text-xs cursor-pointer",
          !value && "text-[var(--muted-foreground)]",
          className,
        )}
      >
        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
        {value ? format(value, "PP") : <span>{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 z-50 bg-[var(--popover)] border border-[var(--border)] rounded-md shadow-lg" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(val) => onChange?.(val)}
          required={false}
        />
      </PopoverContent>
    </Popover>
  );
}
