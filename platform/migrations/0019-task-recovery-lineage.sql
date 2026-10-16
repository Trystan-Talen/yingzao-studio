ALTER TABLE job_items ADD COLUMN retry_source_item_id TEXT REFERENCES job_items(id);
ALTER TABLE job_items ADD COLUMN retry_root_item_id TEXT REFERENCES job_items(id);
ALTER TABLE job_items ADD COLUMN result_data_json TEXT;
ALTER TABLE quotes ADD COLUMN retry_item_ids_json TEXT;
CREATE INDEX job_items_retry_root ON job_items(retry_root_item_id);
-- Recover legacy retry ancestry where the old consumed quote identifies both jobs.
-- Equal-input items are paired by their stable order within the failed subset.
WITH source_items AS (
  SELECT id,job_id,input_json,
    ROW_NUMBER() OVER(PARTITION BY job_id,input_json ORDER BY item_index) AS ordinal
  FROM job_items WHERE status IN ('failed','cancelled')
), child_items AS (
  SELECT id,job_id,input_json,
    ROW_NUMBER() OVER(PARTITION BY job_id,input_json ORDER BY item_index) AS ordinal
  FROM job_items
), ancestry AS (
  SELECT child.id AS child_id,source.id AS source_id
  FROM quotes q JOIN child_items child ON child.job_id=q.used_job_id
    JOIN source_items source ON source.job_id=q.retry_job_id
      AND source.input_json=child.input_json AND source.ordinal=child.ordinal
  WHERE q.retry_job_id IS NOT NULL AND q.used_job_id IS NOT NULL
)
UPDATE job_items SET retry_source_item_id=(
  SELECT source_id FROM ancestry WHERE child_id=job_items.id LIMIT 1
) WHERE id IN (SELECT child_id FROM ancestry);
WITH RECURSIVE roots(id,root_id) AS (
  SELECT id,id FROM job_items WHERE retry_source_item_id IS NULL
  UNION ALL
  SELECT child.id,parent.root_id FROM job_items child
    JOIN roots parent ON child.retry_source_item_id=parent.id
)
UPDATE job_items SET retry_root_item_id=(SELECT root_id FROM roots WHERE roots.id=job_items.id)
WHERE retry_source_item_id IS NOT NULL;
-- Legacy duplicate retries are preserved. New retry exclusion is enforced under
-- the service's BEGIN IMMEDIATE transaction, including those legacy descendants.
