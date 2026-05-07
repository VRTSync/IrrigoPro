import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-13 w-full rounded-xl border-2 border-slate-200 bg-white px-4 text-base",
          "transition-all duration-200",
          "placeholder:text-slate-400",
          "focus:border-sky-400 focus:ring-2 focus:ring-sky-100 focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-slate-600",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
