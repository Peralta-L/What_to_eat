
-- ==========================================
-- 1. USERS
-- ==========================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    lastname TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);


-- ==========================================
-- 2. GLOBAL INGREDIENTS
-- ==========================================

CREATE TABLE IF NOT EXISTS global_ingredients (
    id SERIAL PRIMARY KEY,
    blscode TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    calories NUMERIC,
    fat NUMERIC,
    saturated_fat NUMERIC,
    carbs NUMERIC,
    sugars NUMERIC,
    fiber NUMERIC,
    protein NUMERIC,
    salt NUMERIC
);


-- ==========================================
-- 3. USER INVENTORY (FRIDGE)
-- ==========================================

CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL
        REFERENCES global_ingredients(id) ON DELETE CASCADE,
    users_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL,
    unit TEXT NOT NULL,
    expiration_date DATE,
    UNIQUE (ingredient_id, users_id)
);


-- ==========================================
-- 4. FOODS
-- ==========================================

CREATE TABLE IF NOT EXISTS foods (
    -- Keep your existing foods table definition here.
    -- Its original columns were not included in the
    -- schema shared in our conversation.
);


-- ==========================================
-- 5. USER PREFERENCES
-- ==========================================

CREATE TABLE IF NOT EXISTS preferences (
    -- Keep your existing preferences table definition here.
    -- Its original columns were not included in the
    -- schema shared in our conversation.
);


-- ==========================================
-- 6. RECIPES
-- ==========================================

CREATE TABLE IF NOT EXISTS recipes (
    id SERIAL PRIMARY KEY,

    users_id INTEGER NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    source TEXT NOT NULL DEFAULT 'ai',
    request TEXT,

    -- Stores structured recipe JSON as text.
    content TEXT NOT NULL,

    cooked_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now()
);


-- ==========================================
-- 7. SAVED RECIPES
-- ==========================================

CREATE TABLE IF NOT EXISTS saved_recipes (
    -- Keep your existing saved_recipes definition here.
    -- Its original columns were not included in the
    -- schema shared in our conversation.
);


-- ==========================================
-- 8. INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_recipes_users_id
ON recipes(users_id);

CREATE INDEX IF NOT EXISTS idx_items_users_id
ON items(users_id);

CREATE INDEX IF NOT EXISTS idx_items_ingredient_id
ON items(ingredient_id);
