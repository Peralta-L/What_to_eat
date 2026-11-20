import json
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import HTTPException


def _decode_json_value(value):
    """Decode JSON/JSONB values returned by asyncpg when needed."""
    if isinstance(value, str):
        return json.loads(value)
    return value


def _unit_key(value: str) -> str:
    """Compare unit labels without case/outer-whitespace differences.

    This deliberately does not convert between units (for example, kg and g).
    """
    return value.strip().casefold()


async def cook_recipe_controller(
    user_id: int,
    recipe_id: int,
    idempotency_key: UUID,
    db,
):
    """
    Record one deliberate cooking event and deduct its ingredients.

    A new idempotency key means a new intentional cooking.
    Reusing the same key safely replays the original result.
    """

    try:
        async with db.transaction():

            # 1. Confirm ownership and lock the recipe.
            recipe = await db.fetchrow(
                """
                SELECT id, content
                FROM recipes
                WHERE id = $1
                  AND users_id = $2
                FOR UPDATE
                """,
                recipe_id,
                user_id,
            )

            if recipe is None:
                raise HTTPException(
                    status_code=404,
                    detail="Recipe not found.",
                )

            # 2. Register this cooking action.
            cooking = await db.fetchrow(
                """
                INSERT INTO recipe_cookings (
                    recipe_id,
                    users_id,
                    idempotency_key
                )
                VALUES ($1, $2, $3)
                ON CONFLICT (users_id, idempotency_key)
                DO NOTHING
                RETURNING id
                """,
                recipe_id,
                user_id,
                idempotency_key,
            )

            # 3. If this key already exists, return its original result.
            if cooking is None:
                existing = await db.fetchrow(
                    """
                    SELECT
                        id,
                        recipe_id,
                        cooked_at,
                        deducted_ingredients
                    FROM recipe_cookings
                    WHERE users_id = $1
                      AND idempotency_key = $2
                    """,
                    user_id,
                    idempotency_key,
                )

                if existing is None:
                    raise RuntimeError(
                        "Could not retrieve the existing cooking event."
                    )

                if existing["recipe_id"] != recipe_id:
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            "This idempotency key has already been "
                            "used for another recipe."
                        ),
                    )

                return {
                    "message": "This cooking action was already processed.",
                    "recipe_id": recipe_id,
                    "cooking_id": existing["id"],
                    "cooked_at": existing["cooked_at"],
                    "deducted_ingredients": _decode_json_value(
                        existing["deducted_ingredients"]
                    ),
                    "replayed": True,
                }

            cooking_id = cooking["id"]

            # 4. Parse the recipe content.
            content = _decode_json_value(recipe["content"])

            if not isinstance(content, dict):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid recipe content.",
                )

            ingredients = content.get("ingredients", [])

            if not isinstance(ingredients, list) or not ingredients:
                raise HTTPException(
                    status_code=400,
                    detail="This recipe has no ingredients.",
                )

            # 5. Validate and aggregate ingredient requirements.
            required = {}

            for ingredient in ingredients:
                if not isinstance(ingredient, dict):
                    raise HTTPException(
                        status_code=400,
                        detail="Invalid recipe ingredient.",
                    )

                if ingredient.get("is_available") is False:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"{ingredient.get('name', 'An ingredient')} "
                            "is missing from your fridge."
                        ),
                    )

                raw_id = ingredient.get("ingredient_id")
                raw_quantity = ingredient.get("quantity")
                unit = ingredient.get("unit")

                if raw_id is None or isinstance(raw_id, bool):
                    raise HTTPException(
                        status_code=400,
                        detail="Recipe contains an ingredient without a valid ID.",
                    )

                try:
                    ingredient_id = int(raw_id)
                    quantity = Decimal(str(raw_quantity))
                except (ValueError, TypeError, InvalidOperation):
                    raise HTTPException(
                        status_code=400,
                        detail="Recipe contains invalid ingredient data.",
                    )

                if (
                    ingredient_id <= 0
                    or not quantity.is_finite()
                    or quantity <= 0
                    or not isinstance(unit, str)
                    or not unit.strip()
                ):
                    raise HTTPException(
                        status_code=400,
                        detail="Recipe contains invalid ingredient data.",
                    )

                ingredient_name = ingredient.get("name") or "Ingredient"

                if ingredient_id not in required:
                    required[ingredient_id] = {
                        "quantity": quantity,
                        "unit": unit,
                        "name": ingredient_name,
                    }
                else:
                    previous = required[ingredient_id]

                    if _unit_key(previous["unit"]) != _unit_key(unit):
                        raise HTTPException(
                            status_code=400,
                            detail=(
                                f"Inconsistent units for {ingredient_name}."
                            ),
                        )

                    previous["quantity"] += quantity

            ingredient_ids = sorted(required.keys())

            # 6. Lock the user's inventory rows in a consistent order.
            inventory = await db.fetch(
                """
                SELECT
                    id,
                    ingredient_id,
                    quantity,
                    unit
                FROM items
                WHERE users_id = $1
                  AND ingredient_id = ANY($2::INTEGER[])
                ORDER BY ingredient_id
                FOR UPDATE
                """,
                user_id,
                ingredient_ids,
            )

            inventory_by_id = {
                item["ingredient_id"]: item
                for item in inventory
            }

            # 7. Validate every ingredient before making any deduction.
            for ingredient_id, needed in required.items():
                stock = inventory_by_id.get(ingredient_id)

                if stock is None:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"{needed['name']} is no longer in your fridge."
                        ),
                    )

                if _unit_key(stock["unit"]) != _unit_key(needed["unit"]):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Unit mismatch for {needed['name']}. "
                            f"Fridge: {stock['unit']}, "
                            f"recipe: {needed['unit']}."
                        ),
                    )

                available = Decimal(str(stock["quantity"]))

                if available < needed["quantity"]:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Not enough {needed['name']}. "
                            f"Available: {available} {stock['unit']}, "
                            f"required: {needed['quantity']} {stock['unit']}."
                        ),
                    )

            # 8. Deduct ingredients.
            deducted = []

            for ingredient_id, needed in required.items():
                stock = inventory_by_id[ingredient_id]
                available = Decimal(str(stock["quantity"]))
                remaining = available - needed["quantity"]

                if remaining == 0:
                    await db.execute(
                        """
                        DELETE FROM items
                        WHERE id = $1
                          AND users_id = $2
                        """,
                        stock["id"],
                        user_id,
                    )
                else:
                    await db.execute(
                        """
                        UPDATE items
                        SET quantity = $1
                        WHERE id = $2
                          AND users_id = $3
                        """,
                        remaining,
                        stock["id"],
                        user_id,
                    )

                deducted.append({
                    "ingredient_id": ingredient_id,
                    "name": needed["name"],
                    "quantity": float(needed["quantity"]),
                    "unit": stock["unit"],
                    "remaining": float(remaining),
                })

            # 9. Store the deductions in the cooking event.
            cooking_result = await db.fetchrow(
                """
                UPDATE recipe_cookings
                SET deducted_ingredients = $1::jsonb
                WHERE id = $2
                RETURNING cooked_at
                """,
                json.dumps(deducted),
                cooking_id,
            )

            if cooking_result is None:
                raise RuntimeError("Could not complete the cooking event.")

            # Keep recipes.cooked_at as the most recent cooking timestamp.
            await db.execute(
                """
                UPDATE recipes
                SET cooked_at = $1
                WHERE id = $2
                  AND users_id = $3
                """,
                cooking_result["cooked_at"],
                recipe_id,
                user_id,
            )

        # The transaction has committed at this point.
        return {
            "message": "Recipe cooked successfully!",
            "recipe_id": recipe_id,
            "cooking_id": cooking_id,
            "cooked_at": cooking_result["cooked_at"],
            "deducted_ingredients": deducted,
            "replayed": False,
        }

    except HTTPException:
        raise
    except Exception as error:
        print("COOKING CONFIRMATION ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not confirm cooking. "
                "No inventory changes were saved."
            ),
        )


async def get_recipe_cookings_controller(
    user_id: int,
    recipe_id: int,
    db,
):
    try:
        recipe = await db.fetchrow(
            """
            SELECT id
            FROM recipes
            WHERE id = $1
              AND users_id = $2
            """,
            recipe_id,
            user_id,
        )

        if recipe is None:
            raise HTTPException(
                status_code=404,
                detail="Recipe not found.",
            )

        rows = await db.fetch(
            """
            SELECT
                id,
                cooked_at,
                deducted_ingredients,
                is_legacy
            FROM recipe_cookings
            WHERE recipe_id = $1
              AND users_id = $2
            ORDER BY cooked_at DESC, id DESC
            """,
            recipe_id,
            user_id,
        )

        cookings = []

        for row in rows:
            cooking = dict(row)
            cooking["deducted_ingredients"] = _decode_json_value(
                cooking["deducted_ingredients"]
            )
            cookings.append(cooking)

        return {
            "recipe_id": recipe_id,
            "total_cookings": len(cookings),
            "cookings": cookings,
        }

    except HTTPException:
        raise
    except Exception as error:
        print("GET RECIPE COOKINGS ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve cooking history.",
        )
