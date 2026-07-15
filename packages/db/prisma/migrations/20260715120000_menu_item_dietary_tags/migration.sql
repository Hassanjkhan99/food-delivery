-- Dietary / allergen tags on menu items (customer list-view redesign). Curated set lives
-- in app code (DIETARY_TAGS in @fd/shared); the column is a plain text array like badges.
ALTER TABLE "menu_items" ADD COLUMN "dietaryTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
