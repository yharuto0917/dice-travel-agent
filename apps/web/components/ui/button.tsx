import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "accent" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-bold transition-all " +
  "active:translate-y-[2px] active:translate-x-[2px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-50 border-2 border-line";

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-toy hover:bg-sky",
  accent: "bg-accent text-accent-foreground shadow-toy hover:brightness-110",
  outline: "bg-surface text-foreground shadow-toy hover:bg-surface-2",
  ghost: "border-transparent text-foreground hover:bg-surface-2",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[0.95rem]",
  lg: "h-14 px-7 text-base",
};

/** Link 等にも流用できるよう、バリアントからクラス文字列を生成する。 */
export function buttonVariants({
  variant = "primary",
  size = "md",
}: {
  variant?: Variant;
  size?: Size;
} = {}) {
  return cn(base, variantClasses[variant], sizeClasses[size]);
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
});
