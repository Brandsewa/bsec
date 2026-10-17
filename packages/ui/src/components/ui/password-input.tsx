"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "../../lib/cn"
import { Input } from "./input"

/**
 * Password field with a show/hide toggle. The toggle is a plain button (type="button", so it never submits the
 * form), keyboard reachable, and announces its state. Visibility is local state only: the typed value is not
 * stored or logged anywhere. Always starts hidden.
 */
function PasswordInput({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false)
  const label = visible ? "Hide password" : "Show password"

  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-9", className)} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

export type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">
export { PasswordInput }
