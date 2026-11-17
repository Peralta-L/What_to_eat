import json
from datetime import date
from decimal import Decimal, InvalidOperation
from fastapi import HTTPException

from src.api.services.ai_service import (
    generate_expiration_date,
    generate_recipe_from_items,
    generate_search_recipe as generate_search_recipe_ai,
)

from src.api.controllers.items_controllers import get_items_controller

from src.api.controllers.preferences_controller import (
    get_allergies_controller,
    get_cuisine_controller,
    get_diet_controller,
    get_gluten_free_controller,
)


# ==========================================
# 1. GET USER CONTEXT
# ==========================================

async def _get_user_context(user_id: int, db):
    """
    Retrieve the user's complete inventory and preferences.
    """

    result = await get_items_controller(user_id, db)

    # IMPORTANT:
    # Keep ingredient IDs, quantities and units.
    # Do not reduce this to a list of names.
    items = result["items"]

    allergies = (
        await get_allergies_controller(user_id, db)
    )["allergies"]

    cuisine = (
        await get_cuisine_controller(user_id, db)
    )["cuisines"]

    diet = (
        await get_diet_controller(user_id, db)
    )["diets"]

    gluten_free = (
        await get_gluten_free_controller(user_id, db)
    )["gluten_free"]

    return items, allergies, cuisine, diet, gluten_free


# ==========================================
# 2. SAVE GENERATED RECIPE
# ==========================================

async def _save_recipe(
    db,
    user_id: int,
    content: dict,
    source: str = "ai",
    request: str | None = None,
) -> dict:

    row = await db.fetchrow(
        """
        INSERT INTO recipes (
            users_id,
            source,
            request,
            content
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, users_id, source, request, content, created_at
        """,
        user_id,
        source,
        request,
        json.dumps(content),
    )

    saved_recipe = dict(row)

    # Return structured JSON rather than a JSON string.
    saved_recipe["content"] = json.loads(
        saved_recipe["content"]
    )

    return saved_recipe


# ==========================================
# 3. GENERATE RECIPES FROM FRIDGE
# ==========================================


async def generate_ai_recipe(user_id: int, db):

    try:
        (
            items,
            allergies,
            cuisine,
            diet,
            gluten_free,
        ) = await _get_user_context(user_id, db)

        if not items:
            raise HTTPException(
                status_code=400,
                detail="Your fridge is empty. Add ingredients first.",
            )

        result = await generate_recipe_from_items(
            items,
            allergies,
            cuisine,
            diet,
            gluten_free,
        )

        recipes = result["recipes"]

        saved_recipes = []

        # Save all recipes in one transaction.
        async with db.transaction():

            for recipe in recipes:
                saved = await _save_recipe(
                    db=db,
                    user_id=user_id,
                    content=recipe,
                    source="ai",
                )

                saved_recipes.append(saved)

        return {
            "message": "Recipes generated successfully.",
            "recipes": saved_recipes,
        }

    except HTTPException:
        raise

    except Exception as error:
        print("RECIPE GENERATION ERROR:", str(error))

        raise HTTPException(
            status_code=500,
            detail="Could not generate recipes. Please try again.",
        )


# ==========================================
# 4. GENERATE RECIPE FROM SEARCH
# ==========================================

async def generate_search_recipe(
    user_id: int,
    request: str,
    db,
):

    try:
        (
            items,
            allergies,
            cuisine,
            diet,
            gluten_free,
        ) = await _get_user_context(user_id, db)

        if not items:
            raise HTTPException(
                status_code=400,
                detail="Your fridge is empty. Add ingredients first.",
            )

        result = await generate_search_recipe_ai(
            request,
            items,
            allergies,
            cuisine,
            diet,
            gluten_free,
        )

        saved = await _save_recipe(
            db=db,
            user_id=user_id,
            content=result["recipe"],
            source="search",
            request=request,
        )

        return {
            "message": "Recipe generated successfully.",
            "recipe": saved,
        }

    except HTTPException:
        raise

    except Exception as error:
        print("SEARCH RECIPE ERROR:", str(error))

        raise HTTPException(
            status_code=500,
            detail="Could not generate the requested recipe.",
        )


# ==========================================
# 5. GENERATE INGREDIENT EXPIRATION DATE
# ==========================================

async def generate_info(
    user_id: int,
    ingredient_id: int,
    db,
):

    name = await db.fetchval(
        """
        SELECT global_ingredients.name
        FROM items
        JOIN global_ingredients
            ON items.ingredient_id = global_ingredients.id
        WHERE items.users_id = $1
          AND items.ingredient_id = $2
        """,
        user_id,
        ingredient_id,
    )

    if not name:
        raise HTTPException(
            status_code=404,
            detail="Ingredient not found.",
        )

    expiration = await generate_expiration_date(name)

    try:
        expiration = date.fromisoformat(expiration)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=500,
            detail="Could not interpret the generated expiration date.",
        )

    await db.execute(
        """
        UPDATE items
        SET expiration_date = $1
        WHERE ingredient_id = $2
          AND users_id = $3
        """,
        expiration,
        ingredient_id,
        user_id,
    )

    return {"expiration": expiration}


# ==========================================
# 6. CONFIRM COOKING AND DEDUCT INGREDIENTS
# ==========================================

async def cook_recipe_controller(
    user_id: int,
    recipe_id: int,
    db,
):
    try:
        async with db.transaction():

            # 1. Lock the recipe to prevent simultaneous cooking requests.
            recipe = await db.fetchrow(
                """
                SELECT id, users_id, content, cooked_at
                FROM recipes
                WHERE id = $1 AND users_id = $2
                FOR UPDATE
                """,
                recipe_id,
                user_id,
            )

            if not recipe:
                raise HTTPException(
                    status_code=404,
                    detail="Recipe not found.",
                )

            # 2. Prevent deducting ingredients twice.
            if recipe["cooked_at"] is not None:
                raise HTTPException(
                    status_code=409,
                    detail="This recipe has already been cooked.",
                )

            # 3. Read the saved recipe.
            content = recipe["content"]

            if isinstance(content, str):
                content = json.loads(content)

            ingredients = content.get("ingredients", [])

            if not ingredients:
                raise HTTPException(
                    status_code=400,
                    detail="This recipe has no ingredients.",
                )

            # 4. Validate and aggregate ingredient quantities.
            required = {}

            for ingredient in ingredients:

                if ingredient.get("is_available") is False:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"{ingredient.get('name', 'An ingredient')} "
                            "is missing from your fridge."
                        ),
                    )

                ingredient_id = ingredient.get("ingredient_id")

                if ingredient_id is None:
                    raise HTTPException(
                        status_code=400,
                        detail="Recipe contains an ingredient without an ID.",
                    )

                try:
                    ingredient_id = int(ingredient_id)
                    quantity = Decimal(str(ingredient["quantity"]))
                except (ValueError, TypeError, KeyError, InvalidOperation):
                    raise HTTPException(
                        status_code=400,
                        detail="Recipe contains invalid ingredient data.",
                    )

                unit = ingredient.get("unit")

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

                if ingredient_id not in required:
                    required[ingredient_id] = {
                        "quantity": quantity,
                        "unit": unit,
                        "name": ingredient.get("name", "Ingredient"),
                    }

                else:
                    existing = required[ingredient_id]

                    if existing["unit"] != unit:
                        raise HTTPException(
                            status_code=400,
                            detail="An ingredient has inconsistent units.",
                        )

                    existing["quantity"] += quantity

            ingredient_ids = sorted(required.keys())

            # 5. Lock the user's inventory rows.
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

            # 6. Check ALL ingredients before making any changes.
            for ingredient_id, needed in required.items():

                stock = inventory_by_id.get(ingredient_id)

                if not stock:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{needed['name']} is no longer in your fridge.",
                    )

                if stock["unit"] != needed["unit"]:
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

            # 7. Deduct ingredients only after every check passes.
            deducted = []

            for ingredient_id, needed in required.items():

                stock = inventory_by_id[ingredient_id]

                available = Decimal(str(stock["quantity"]))
                remaining = available - needed["quantity"]

                if remaining == 0:
                    await db.execute(
                        """
                        DELETE FROM items
                        WHERE id = $1 AND users_id = $2
                        """,
                        stock["id"],
                        user_id,
                    )
                else:
                    await db.execute(
                        """
                        UPDATE items
                        SET quantity = $1
                        WHERE id = $2 AND users_id = $3
                        """,
                        remaining,
                        stock["id"],
                        user_id,
                    )

                deducted.append({
                    "ingredient_id": ingredient_id,
                    "name": needed["name"],
                    "quantity": float(needed["quantity"]),
                    "unit": needed["unit"],
                    "remaining": float(remaining),
                })

            # 8. Mark the recipe as cooked.
            cooked_recipe = await db.fetchrow(
                """
                UPDATE recipes
                SET cooked_at = NOW()
                WHERE id = $1
                  AND users_id = $2
                  AND cooked_at IS NULL
                RETURNING cooked_at
                """,
                recipe_id,
                user_id,
            )

            if not cooked_recipe:
                raise HTTPException(
                    status_code=409,
                    detail="Could not confirm cooking.",
                )

        # Transaction committed successfully.
        return {
            "message": "Recipe cooked successfully!",
            "recipe_id": recipe_id,
            "cooked_at": cooked_recipe["cooked_at"],
            "deducted_ingredients": deducted,
        }

    except HTTPException:
        raise

    except Exception as error:
        print("COOKING CONFIRMATION ERROR:", str(error))

        raise HTTPException(
            status_code=500,
            detail="Could not confirm cooking. No inventory changes were saved.",
        )
