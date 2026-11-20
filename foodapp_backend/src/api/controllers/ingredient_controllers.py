
from fastapi import HTTPException
import src.core.database as db


async def search_ingredient_controller(ingredient: str):
    if db.pool is None:
        raise HTTPException(
            status_code=500,
            detail="Database connection is not initialized"
        )

    search_term = ingredient.strip()

    if not search_term:
        return {"ingredients": []}

    try:
        async with db.pool.acquire() as connection:
            rows = await connection.fetch(
                """
                SELECT
                    id,
                    blscode,
                    name,
                    category,
                    calories,
                    fat,
                    saturated_fat,
                    carbs,
                    sugars,
                    fiber,
                    protein,
                    salt
                FROM global_ingredients
                WHERE
                    name ILIKE $1
                    AND name ~* '(^|[^[:alnum:]])raw([^[:alnum:]]|$)'
                ORDER BY
                    CASE
                        WHEN name ILIKE $2 THEN 0
                        ELSE 1
                    END,
                    name ASC
                LIMIT 50
                """,
                f"%{search_term}%",
                f"{search_term}%"
            )

        return {
            "ingredients": [dict(row) for row in rows]
        }

    except Exception as e:
        print("Ingredient search error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail=f"Could not search ingredients: {str(e)}"
        )