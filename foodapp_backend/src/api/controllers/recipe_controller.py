from asyncpg import UniqueViolationError
from fastapi import HTTPException


async def save_recipe_controller(user_id: int, recipe_id: int, db):
    try:
        await db.execute(
            "INSERT INTO saved_recipes (users_id, recipe_id) VALUES ($1, $2)",
            user_id,
            recipe_id,
        )
        return {"message": "Recipe saved successfully"}
    except UniqueViolationError:
        raise HTTPException(status_code=400, detail="Recipe already saved")


async def get_saved_recipes_controller(user_id: int, db):
    rows = await db.fetch(
        """
        SELECT recipes.id, recipes.source, recipes.request, recipes.content, recipes.created_at
        FROM saved_recipes
        JOIN recipes ON saved_recipes.recipe_id = recipes.id
        WHERE saved_recipes.users_id = $1
        ORDER BY saved_recipes.saved_at DESC
        """,
        user_id,
    )
    return {"saved_recipes": [dict(row) for row in rows]}


async def unsave_recipe_controller(user_id: int, recipe_id: int, db):
    await db.execute(
        "DELETE FROM saved_recipes WHERE users_id = $1 AND recipe_id = $2",
        user_id,
        recipe_id,
    )
    return {"message": "Recipe removed from saved"}