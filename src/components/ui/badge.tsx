import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// `rounded-sm`, not `rounded-4xl`. With the multiplicative radius scale
// --radius-4xl is 26px, i.e. a full pill. The brand's status pills are squared
// (5px in the reference), and that one change carries a surprising amount of
// the "considered" feel — pills read as consumer, squared chips as instrument.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive-muted text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/20",
        // Status variants. Every one of these replaces a copy-pasted
        // `bg-X-100 text-X-800 dark:bg-X-500/15 dark:text-X-300` string — the
        // tokens carry the light/dark pair, so call sites never write `dark:`.
        // Note `warning` and `info` are desaturated teal-greys by design, not
        // amber and blue; see the palette comment in globals.css.
        success: "bg-success-muted text-success [a]:hover:bg-success/20",
        warning: "bg-warning-muted text-warning [a]:hover:bg-warning/20",
        info: "bg-info-muted text-info [a]:hover:bg-info/20",
        neutral: "bg-muted text-muted-foreground [a]:hover:bg-muted/80",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

/**
 * The variant names, as a type. Status→meta maps across the app store a variant
 * per state; without this they fall back to `string` and a typo only shows up as
 * an unstyled badge at runtime.
 */
export type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>["variant"]
>

export { Badge, badgeVariants }
