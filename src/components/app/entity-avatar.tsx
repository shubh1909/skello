import { cva, type VariantProps } from "class-variance-authority";

import { avatarTone, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

const entityAvatar = cva(
  "grid shrink-0 place-items-center rounded-full font-medium",
  {
    variants: {
      size: {
        sm: "size-8 text-[11px]",
        lg: "size-12 text-sm",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

/**
 * A person's initials on their own colour.
 *
 * Four surfaces hand-rolled this as `bg-muted text-muted-foreground` initials —
 * so every row in a leads table had an identical grey disc, which is a
 * decoration that costs 32px and tells you nothing. The tone is hashed from
 * the name, so the same person is the same colour in the table, the detail
 * sheet and the pulse list, and scanning a list becomes possible.
 *
 * The initials are always redundant with a name rendered beside them, so this
 * is `aria-hidden`: a screen reader announcing "J D" before "Jane Doe" is
 * noise. Callers must keep the name in the DOM — every current one does.
 *
 * Not `ui/avatar`: there are no photo URLs anywhere in this product, so the
 * image/fallback machinery would be a fallback that never falls back.
 */
export function EntityAvatar({
  name,
  size,
  className,
}: VariantProps<typeof entityAvatar> & {
  name: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(entityAvatar({ size }), avatarTone(name), className)}
    >
      {initialsOf(name)}
    </span>
  );
}
