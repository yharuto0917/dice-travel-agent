import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind のクラス名を安全に結合・マージするヘルパー。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
