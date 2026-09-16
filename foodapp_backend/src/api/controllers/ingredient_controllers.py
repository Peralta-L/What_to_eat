import httpx
from fastapi import HTTPException
from src.core.food import settings
from src.schemas.ingredient_schema import IngredientAdd

USDA_BASE = "https://api.nal.usda.gov/fdc/v1"

def _get_nutrient(nutrients: list, number: str) -> float | None:
    for n in nutrients:
        if str(n.get("nutrientNumber")) == number:
            return n.get("value")
    return None

async def _fetch_from_usda(ingredient: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{USDA_BASE}/foods/search",
            params={
                "query": f"{ingredient}*",
                "pageSize": 20,
                "dataType": "Foundation,SR Legacy",
                "api_key": settings.USDA_API_KEY,
            },
        )
        resp.raise_for_status()
        foods = resp.json().get("foods", [])

    results = []
    for food in foods:
        nutrients = food.get("foodNutrients", [])
        results.append({
            "fdc_id":   food["fdcId"],
            "name":     food["description"],
            "category": food.get("foodCategory", None),
            "calories": _get_nutrient(nutrients, "208"),
            "protein":  _get_nutrient(nutrients, "203"),
            "fat":      _get_nutrient(nutrients, "204"),
            "carbs":    _get_nutrient(nutrients, "205"),
        })
    return results

async def search_ingredient_controller(ingredient: str, db):
    try:
        rows = await db.fetch(
            """
            SELECT id, name, category, calories, protein, fat, carbs
            FROM global_ingredients WHERE name ILIKE $1 LIMIT 5
            """,
            f"%{ingredient}%"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if rows:
        return {"ingredients": [dict(row) for row in rows], "source": "global"}

    try:
        data = await _fetch_from_usda(ingredient)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"USDA API error: {str(e)}")

    if not data:
        raise HTTPException(status_code=404, detail="Ingredient not found")

    return {"ingredients": data, "source": "usda"}


async def add_ingredient_controller(ingredient: IngredientAdd, db):
    try:
        row = await db.fetchrow(
            """
            INSERT INTO global_ingredients (fdc_id, name, category, calories, protein, fat, carbs)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (fdc_id) DO UPDATE
                SET name     = EXCLUDED.name,
                    category = EXCLUDED.category,
                    calories = EXCLUDED.calories,
                    protein  = EXCLUDED.protein,
                    fat      = EXCLUDED.fat,
                    carbs    = EXCLUDED.carbs
            RETURNING id, name, category, calories, protein, fat, carbs
            """,
            ingredient.fdc_id,
            ingredient.name,
            ingredient.category,
            ingredient.calories,
            ingredient.protein,
            ingredient.fat,
            ingredient.carbs
        )
        return {**dict(row), "source": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))