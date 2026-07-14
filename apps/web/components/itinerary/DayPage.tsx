import type { PlanDay } from "@repo/shared";
import { TimelineItemCard } from "./TimelineItemCard";

interface DayPageProps {
  day: PlanDay;
}

export function DayPage({ day }: DayPageProps) {
  // Draft対応としてitemsが空の場合のフォールバック
  const hasItems = day.items && day.items.length > 0;

  return (
    <div className="flex flex-col w-full p-6 sm:p-10 relative">
      <div className="mb-6 flex flex-col gap-1 pl-10 relative z-10">
        <h2 className="text-2xl font-extrabold text-ink">{day.title ?? `Day ${day.dayNumber}`}</h2>
        {day.date ? <span className="text-sm font-bold text-muted">{day.date}</span> : null}
      </div>

      <div className="flex-1 relative pl-10">
        {hasItems ? (
          <div className="flex flex-col gap-6 relative">
            {/* Vertical Timeline Line */}
            <div className="absolute left-[11px] top-2 bottom-4 w-0.5 bg-line/20 z-0" />

            {day.items.map((item) => (
              <div key={item.id} className="relative pl-8">
                {/* Timeline Dot */}
                <div className="absolute left-[6px] top-[1.35rem] w-3 h-3 rounded-full bg-surface border-2 border-primary z-10" />
                <TimelineItemCard item={item} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-muted text-sm border-2 border-dashed border-line rounded-xl ml-8">
            予定はまだありません
          </div>
        )}
      </div>
    </div>
  );
}
