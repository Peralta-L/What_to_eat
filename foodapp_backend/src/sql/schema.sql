-- Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    lastname TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);

-- Shared ingredient reference data (from USDA lookups or manual entry)
CREATE TABLE IF NOT EXISTS global_ingredients (
    id SERIAL PRIMARY KEY,
    fdc_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    calories NUMERIC,
    protein NUMERIC,
    fat NUMERIC,
    carbs NUMERIC
);

-- A user's pantry/inventory
CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES global_ingredients(id) ON DELETE CASCADE,
    users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL,
    unit TEXT NOT NULL,
    experation_date DATE,
    UNIQUE (ingredient_id, users_id)
);

-- User-created foods/recipes
CREATE TABLE IF NOT EXISTS foods (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    ingredients TEXT,
    calories NUMERIC,
    preparation_time INTEGER,
    dietary_restrictions TEXT,
    nutrition JSONB,
    users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (name, users_id)
);

-- Preferences: one row per value (matches update_preferences_controller's insert-per-item pattern)
CREATE TABLE IF NOT EXISTS preferences (
    id SERIAL PRIMARY KEY,
    users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    allergies TEXT,
    cuisine_pref TEXT,
    diet_pref TEXT,
    is_glutenfree BOOLEAN DEFAULT FALSE
);