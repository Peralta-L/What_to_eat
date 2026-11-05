-- Users
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    lastname TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
);

-- Shared ingredient reference data (I have inserted all the data from an German association or manual entry)
CREATE TABLE IF NOT EXISTS global_ingredients (
    id SERIAL PRIMARY KEY,
    blscode TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,

    -- Nutritional values per 100g
    calories NUMERIC,
    fat NUMERIC,
    saturated_fat NUMERIC,
    carbs NUMERIC,
    sugars NUMERIC,
    fiber NUMERIC,
    protein NUMERIC,
    salt NUMERIC
);

-- A user's pantry/inventory
CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES global_ingredients(id) ON DELETE CASCADE,
    users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quantity NUMERIC NOT NULL,
    unit TEXT NOT NULL,
    expiration_date DATE,
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

-- AI-generated recipes (raw model output, stored so it can be favorited/revisited)
CREATE TABLE IF NOT EXISTS recipes (
    id SERIAL PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'ai',
    request TEXT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Which user saved/favorited which recipe
CREATE TABLE IF NOT EXISTS saved_recipes (
    id SERIAL PRIMARY KEY,
    users_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    saved_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (users_id, recipe_id)
);