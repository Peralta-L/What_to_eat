from fastapi import APIRouter, Query, HTTPException
from src.core.database import pool

router = APIRouter()


@router.get("/ingredients")
async def search_ingredients(
    ingredient: str = Query(..., min_length=3)
):
    if pool is None:
        raise HTTPException(
            status_code=500,
            detail="Database connection is not initialized"
        )

    try:
        async with pool.acquire() as connection:
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
                WHERE name ILIKE $1
                ORDER BY name ASC
                LIMIT 50
                """,
                f"%{ingredient.strip()}%"
            )

        return {
            "ingredients": [dict(row) for row in rows]
        }

    except Exception as e:
        print("Ingredient search error:", e)

        raise HTTPException(
            status_code=500,
            detail="Could not search ingredients"
        )