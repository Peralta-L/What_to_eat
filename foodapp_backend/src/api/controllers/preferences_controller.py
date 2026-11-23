from src.schemas.preferences_schema import Preferences

EMPTY = {"allergies": [], "cuisines": [], "diets": [], "gluten_free": False}


async def get_preferences_controller(user_id: int, db):
    row = await db.fetchrow(
        """
        SELECT allergies, cuisines, diets, is_glutenfree
        FROM preferences
        WHERE users_id = $1
        """,
        user_id,
    )
    if row is None:
        return dict(EMPTY)  # a new user simply has no preferences yet
    return {
        "allergies": list(row["allergies"]),
        "cuisines": list(row["cuisines"]),
        "diets": list(row["diets"]),
        "gluten_free": row["is_glutenfree"],
    }


async def update_preferences_controller(user_id: int, prefs: Preferences, db):
    async with db.transaction():
        await db.execute(
            """
            INSERT INTO preferences (users_id, allergies, cuisines, diets, is_glutenfree)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (users_id) DO UPDATE SET
                allergies     = EXCLUDED.allergies,
                cuisines      = EXCLUDED.cuisines,
                diets         = EXCLUDED.diets,
                is_glutenfree = EXCLUDED.is_glutenfree
            """,
            user_id, prefs.allergies, prefs.cuisines, prefs.diets, prefs.gluten_free,
        )

        # Remove stale generated suggestions only. Recipes already in recent
        # history, Loved ones, or cooking history remain attached to the user.
        await db.execute(
            """
            DELETE FROM recipes r
            WHERE r.users_id = $1
              AND r.source IN ('ai', 'selected')
              AND NOT EXISTS (
                  SELECT 1 FROM recipe_view_history h
                  WHERE h.users_id = r.users_id AND h.recipe_id = r.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM recipe_favourites f
                  WHERE f.users_id = r.users_id AND f.recipe_id = r.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM saved_recipes sr
                  WHERE sr.users_id = r.users_id AND sr.recipe_id = r.id
              )
              AND NOT EXISTS (
                  SELECT 1 FROM recipe_cookings c
                  WHERE c.users_id = r.users_id AND c.recipe_id = r.id
              )
            """,
            user_id,
        )
    return prefs.model_dump()