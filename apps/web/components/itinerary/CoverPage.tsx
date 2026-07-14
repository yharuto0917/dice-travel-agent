import type { TravelPlan } from "@repo/shared";
import { resolveAssetUrl } from "@/lib/api";

interface CoverPageProps {
  plan: Partial<TravelPlan>;
}

export function CoverPage({ plan }: CoverPageProps) {
  // coverImage がなければ images[0]、それでもなければ days[0]?.items 内の画像を探す
  const fallbackImage =
    plan.images?.[0] ?? plan.days?.flatMap((d) => d.items).find((i) => i.image?.url)?.image;

  const displayImage = plan.coverImage ?? fallbackImage;
  const attribution = displayImage?.attribution;

  return (
    <div className="flex flex-col w-full p-6 sm:p-10 relative">
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-8 pl-6">
        {displayImage?.url ? (
          <div className="w-full flex flex-col gap-2">
            <div className="overflow-hidden rounded-2xl border-4 border-line aspect-[4/3] shadow-toy bg-surface-2">
              <img
                src={resolveAssetUrl(displayImage.url)}
                alt="Cover"
                className="w-full h-full object-cover"
              />
            </div>
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

        <div className="flex flex-col gap-4 mt-4">
          <h1 className="text-3xl font-black text-ink leading-tight">
            {plan.title ?? "旅のしおり"}
          </h1>
          {plan.summary ? <p className="text-base text-muted font-medium">{plan.summary}</p> : null}
        </div>

        <div className="mt-4 flex flex-col gap-2 font-bold text-sm text-ink bg-surface-2 p-4 rounded-xl border-2 border-line w-full">
          <div>出発日: {plan.startDate ?? "未定"}</div>
          <div>日数: {plan.nights ? `${plan.nights}泊${plan.nights + 1}日` : "未定"}</div>
        </div>
      </div>
    </div>
  );
}
