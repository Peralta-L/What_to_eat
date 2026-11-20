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
    return prefs.model_dump()