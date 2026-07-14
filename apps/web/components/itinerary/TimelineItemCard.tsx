import type { PlanItem } from "@repo/shared";
import { PLAN_ITEM_LABELS } from "@/lib/agent";
import { resolveAssetUrl } from "@/lib/api";

interface TimelineItemCardProps {
  item: PlanItem;
}

export function TimelineItemCard({ item }: TimelineItemCardProps) {
  // attributionの優先度解決: image.attribution > item.attribution
  const attribution = item.image?.attribution ?? item.attribution;

  return (
    <div className="relative flex flex-col gap-1 pb-6">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            {item.startTime ? (
              <span className="font-extrabold text-ink text-lg tracking-wider border-b-2 border-accent/50 pb-0.5">
                {item.startTime}
              </span>
            ) : null}
            <h3 className="font-extrabold text-lg text-ink">{item.title}</h3>
            {/* Type badge like a small stamp */}
            <span className="rounded border border-muted/40 text-muted px-1.5 py-0.5 text-[0.65rem] font-bold">
              {PLAN_ITEM_LABELS[item.type] ?? item.type}
            </span>
          </div>

          {item.description ? (
            <p className="text-sm text-ink/80 leading-[1.8] mb-3">{item.description}</p>
          ) : null}

          {/* Cost/Duration info like scribbled notes */}
          {item.cost?.amount != null || item.durationMin != null ? (
            <div className="flex flex-wrap gap-4 text-xs text-muted/90 font-bold mb-4 bg-surface-2/40 px-3 py-2 rounded-lg inline-flex">
              {item.cost?.amount != null ? <span>¥{item.cost.amount.toLocaleString()}</span> : null}
              {item.durationMin != null ? <span>{item.durationMin}分</span> : null}
            </div>
          ) : null}

          {/* Image (Polaroid style) */}
          {item.image?.url ? (
            <div className="mt-2 flex flex-col gap-1 relative w-fit max-w-full">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-7 masking-tape z-10 rotate-[1deg]" />
              <div className="overflow-hidden border-[8px] border-b-[24px] border-white shadow-sm bg-white aspect-[4/3] rotate-[-2deg] relative">
                <img
                  src={resolveAssetUrl(item.image.url)}
                  alt={item.title}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </div>
              {/* Attribution */}
              {attribution ? (
                <div className="text-[10px] text-muted text-right pr-1">
                  Photo by{" "}
                  {attribution.url && attribution.url.startsWith("http") ? (
                    <a
                      href={attribution.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-ink"
                    >
                      {attribution.author ?? "Unknown"}
                    </a>
                  ) : (
                    <span>{attribution.author ?? "Unknown"}</span>
                  )}
                  {attribution.source ? ` on ${attribution.source}` : ""}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
