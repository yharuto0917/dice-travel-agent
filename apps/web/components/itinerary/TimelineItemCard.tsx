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
    <div className="relative flex flex-col gap-2 rounded-2xl bg-paper border-2 border-line p-4 shadow-toy mb-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {/* Type badge */}
            <span className="rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-bold text-accent-foreground border-2 border-line shadow-toy">
              {PLAN_ITEM_LABELS[item.type] ?? item.type}
            </span>
            {item.startTime ? (
              <span className="font-bold text-ink bg-surface-2 px-1.5 py-0.5 rounded text-sm">
                {item.startTime}
              </span>
            ) : null}
            <h3 className="font-bold text-base text-ink line-clamp-2">{item.title}</h3>
          </div>

          {item.description ? (
            <p className="text-sm text-muted line-clamp-3 mb-2">{item.description}</p>
          ) : null}

          {/* Image */}
          {item.image?.url ? (
            <div className="mt-4 flex flex-col gap-1 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-20 h-6 masking-tape z-10 rotate-[1deg]" />
              <div className="overflow-hidden border-[6px] border-white shadow-sm bg-white aspect-[4/3] rotate-[-1deg] relative">
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
                  {attribution.url ? (
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

          {/* Cost/Duration info if available */}
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted font-bold">
            {item.cost?.amount ? (
              <span className="bg-surface-2 px-1.5 py-0.5 rounded">
                ¥{item.cost.amount.toLocaleString()}
              </span>
            ) : null}
            {item.durationMin ? (
              <span className="bg-surface-2 px-1.5 py-0.5 rounded">{item.durationMin}分</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
