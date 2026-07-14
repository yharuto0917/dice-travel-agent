import type { BudgetBreakdown } from "@repo/shared";

interface BudgetPageProps {
  budget: BudgetBreakdown;
}

export function BudgetPage({ budget }: BudgetPageProps) {
  return (
    <div className="w-full flex flex-col p-6 sm:p-10 relative">
      <div className="flex-1 pl-8 pr-2 pt-4 select-none leading-[32px] text-sm relative z-10">
        <h2 className="text-xl font-extrabold mb-8 text-ink inline-block pr-4">旅の予算メモ</h2>

        <ul className="space-y-[0px] font-sans font-bold text-ink">
          {budget.lodging?.amount != null ? (
            <li className="flex justify-between items-center h-[32px]">
              <span>🏨 宿泊費</span>
              <span>¥{budget.lodging.amount.toLocaleString()}</span>
            </li>
          ) : null}
          {budget.transport?.amount != null ? (
            <li className="flex justify-between items-center h-[32px]">
              <span>🚄 交通費</span>
              <span>¥{budget.transport.amount.toLocaleString()}</span>
            </li>
          ) : null}
          {budget.food?.amount != null ? (
            <li className="flex justify-between items-center h-[32px]">
              <span>🍔 食費</span>
              <span>¥{budget.food.amount.toLocaleString()}</span>
            </li>
          ) : null}
          {budget.activities?.amount != null ? (
            <li className="flex justify-between items-center h-[32px]">
              <span>🎟️ 観光・体験</span>
              <span>¥{budget.activities.amount.toLocaleString()}</span>
            </li>
          ) : null}
          {budget.other?.amount != null ? (
            <li className="flex justify-between items-center h-[32px]">
              <span>💰 その他</span>
              <span>¥{budget.other.amount.toLocaleString()}</span>
            </li>
          ) : null}
        </ul>

        {/* Total highlighting */}
        {budget.total?.amount != null ? (
          <div className="mt-8 flex justify-between items-center border-t-2 border-dashed border-line pt-2 h-[32px]">
            <span className="font-extrabold text-primary">合計目安</span>
            <span className="font-extrabold text-lg text-accent-foreground bg-accent px-2 py-0.5 rounded shadow-toy border-2 border-line">
              ¥{budget.total.amount.toLocaleString()}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
