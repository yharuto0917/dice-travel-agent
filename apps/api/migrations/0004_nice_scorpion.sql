-- 旧実装では版更新が CAS ではなかったため、並行確定で同じ (plan_id, version) が
-- 複数作られている可能性がある。最も早く保存されたスナップショットだけを残してから
-- 一意制約を張り、既存データが原因で migration 全体が止まるのを防ぐ。
DELETE FROM `plan_versions`
WHERE `id` IN (
	SELECT `id`
	FROM (
		SELECT
			`id`,
			ROW_NUMBER() OVER (
				PARTITION BY `plan_id`, `version`
				ORDER BY julianday(`created_at`) ASC, `id` ASC
			) AS `duplicate_rank`
		FROM `plan_versions`
	)
	WHERE `duplicate_rank` > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_versions_plan_id_version_unique` ON `plan_versions` (`plan_id`,`version`);
