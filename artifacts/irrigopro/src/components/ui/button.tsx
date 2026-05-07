import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-sky-500 text-white hover:bg-sky-600 shadow-md shadow-sky-500/25 hover:shadow-lg hover:shadow-sky-500/30",
        destructive: "bg-red-500 text-white hover:bg-red-600 shadow-md shadow-red-500/25",
        outline: "border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300",
        secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        link: "text-sky-500 underline-offset-4 hover:underline",
        success: "bg-emerald-500 text-white hover:bg-emerald-600 shadow-md shadow-emerald-500/25",
      },
      size: {
        default: "h-12 px-6 rounded-xl text-base [&_svg]:size-5",
        sm: "h-10 px-4 rounded-lg text-sm [&_svg]:size-4",
        lg: "h-14 px-8 rounded-xl text-lg [&_svg]:size-6",
        icon: "h-12 w-12 rounded-xl [&_svg]:size-5",
        "icon-sm": "h-10 w-10 rounded-lg [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
