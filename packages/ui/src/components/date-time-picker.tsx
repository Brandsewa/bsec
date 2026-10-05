"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Clock } from "lucide-react";
import { Calendar } from "./ui/calendar.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { Input } from "./ui/input.tsx";
import { cn } from "../lib/cn.ts";

export interface DateTimePickerProps {
  value?: Date | undefined;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick date and time",
  disabled,
  className,
}: DateTimePickerProps) {
  const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(value);
  const [timeStr, setTimeStr] = React.useState<string>(
    value ? format(value, "HH:mm") : "12:00",
  );

  const [prevValue, setPrevValue] = React.useState<Date | undefined>(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setSelectedDate(value);
    if (value) {
      setTimeStr(format(value, "HH:mm"));
    }
  }

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      setSelectedDate(undefined);
      onChange?.(undefined);
      return;
    }

    const [hours, minutes] = timeStr.split(":").map(Number);
    const newDate = new Date(date);
    newDate.setHours(hours ?? 12, minutes ?? 0, 0, 0);
    setSelectedDate(newDate);
    onChange?.(newDate);
  };

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTimeStr(val);
    if (selectedDate && val) {
      const [hours, minutes] = val.split(":").map(Number);
      const newDate = new Date(selectedDate);
      newDate.setHours(hours ?? 12, minutes ?? 0, 0, 0);
      setSelectedDate(newDate);
      onChange?.(newDate);
    }
  };

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-start text-left font-normal h-8 px-3 rounded-[var(--radius-button)] border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--muted)] text-xs cursor-pointer",
          !selectedDate && "text-[var(--muted-foreground)]",
          className,
        )}
      >
        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
        {selectedDate ? (
          format(selectedDate, "PP p")
        ) : (
          <span>{placeholder}</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 space-y-3" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          required={false}
        />
        <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
          <Clock className="h-4 w-4 text-[var(--muted-foreground)]" />
          <Input
            type="time"
            value={timeStr}
            onChange={handleTimeChange}
            className="h-8 text-xs w-full"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
