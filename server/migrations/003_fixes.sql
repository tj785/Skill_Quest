-- Placing and removing the same block must not earn progress twice:
-- blocks_placed is now the net number of blocks a student has standing,
-- and blocks_credited is the highest it has ever been (progress is only given above it).
ALTER TABLE students ADD COLUMN blocks_credited INTEGER NOT NULL DEFAULT 0;
UPDATE students SET blocks_credited = blocks_placed;
