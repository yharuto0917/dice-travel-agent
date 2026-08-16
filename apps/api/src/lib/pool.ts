/**
 * 並列度を制限しつつ全件を処理するワーカープール。
 *
 * チャンク分割（`slice` して `Promise.all` を順に await）と違い、**barrier が無い**。
 * チャンク方式は同バッチの最も遅い1件が他を待たせるため、1件あたりの所要が
 * ばらつく処理（LLM 呼び出しなど）では待ち時間が積み上がる。ここでは
 * 先に空いたワーカーが次のタスクを引くため、全体の所要は「並列数で割った合計」に近づく。
 *
 * 戻り値は `Promise.allSettled` と同じ形（入力と同じ順序）。1件の失敗が全体を
 * 落とさないため、呼び出し側は成功分だけを採用できる。
 *
 * @param items 処理対象。空配列なら即座に空配列を返す。
 * @param limit 同時実行数の上限。1 未満は 1 に、要素数より大きい値は要素数に丸める。
 * @param task 各要素に対する処理。要素とその添字を受け取る。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;

  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  // 各ワーカーが取り合うカーソル。JS は単一スレッドで `cursor++` が不可分なため
  // 追加のロックなしに「同じ添字を2回処理しない」ことが保証される。
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    let index = cursor++;
    while (index < items.length) {
      // 添字は必ず範囲内だが noUncheckedIndexedAccess が undefined を混ぜるためキャストする。
      // `item !== undefined` で弾くと、T が undefined を含む場合にその要素だけ握り潰される。
      const item = items[index] as T;
      try {
        results[index] = { status: "fulfilled", value: await task(item, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
      index = cursor++;
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return results;
}
