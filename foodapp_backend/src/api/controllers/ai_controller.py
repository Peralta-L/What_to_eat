import json
from decimal import Decimal, InvalidOperation
from uuid import UUID

from fastapi import HTTPException

from src.api.services.ai_service import (
    generate_recipe_from_items,
    generate_search_recipe as generate_search_recipe_ai,
)
from src.api.controllers.items_controllers import get_items_controller
from src.api.services.expiration_service import estimate_expiration_date
from src.api.controllers.preferences_controller import (get_preferences_controller)


# ============================================================
# SHARED HELPERS
# ============================================================

def _decode_json_value(value):
    """Decode JSON/JSONB values returned by asyncpg when needed."""
    if isinstance(value, str):
        return json.loads(value)
    return value


# ============================================================
# 1. GET USER CONTEXT
# ============================================================

async def _get_user_context(user_id: int, db):
    result = await get_items_controller(user_id, db)
    prefs = await get_preferences_controller(user_id, db)
    return (
        result["items"],
        prefs["allergies"],
        prefs["cuisines"],
        prefs["diets"],
        prefs["gluten_free"],
    )


# ============================================================
# 2. SAVE GENERATED RECIPE
# ============================================================

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

    if row is None:
        raise RuntimeError("Recipe was not returned after saving.")

    saved_recipe = dict(row)
    saved_recipe["content"] = _decode_json_value(saved_recipe["content"])
    return saved_recipe


# ============================================================
# 3. GENERATION REQUEST IDEMPOTENCY + SHARED GENERATION
# ============================================================

async def _claim_generation_request(
    user_id: int,
    idempotency_key: UUID,
    generation_type: str,
    db,
):
    """Claim one generation request or return its previously saved result.

    Concurrent duplicate requests with the same key cannot create a second
    recipe batch. A stale processing claim can be recovered after 15 minutes.
    """
    async with db.transaction():
        inserted = await db.fetchrow(
            """
            INSERT INTO recipe_generation_requests (
                users_id,
                idempotency_key,
                generation_type,
                status,
                started_at
            )
            VALUES ($1, $2, $3, 'processing', NOW())
            ON CONFLICT (users_id, idempotency_key) DO NOTHING
            RETURNING id
            """,
            user_id,
            idempotency_key,
            generation_type,
        )

        if inserted is not None:
            return None

        existing = await db.fetchrow(
            """
            SELECT generation_type, status, recipe_ids, started_at
            FROM recipe_generation_requests
            WHERE users_id = $1
              AND idempotency_key = $2
            FOR UPDATE
            """,
            user_id,
            idempotency_key,
        )

        if existing is None:
            raise RuntimeError("Could not retrieve the generation request.")

        if existing["generation_type"] != generation_type:
            raise HTTPException(
                status_code=409,
                detail="This generation key was already used for a different action.",
            )

        if existing["status"] == "completed":
            recipe_ids = list(existing["recipe_ids"] or [])
            if not recipe_ids:
                return {
                    "message": "This generation request was already processed.",
                    "recipes": [],
                    "replayed": True,
                }

            rows = await db.fetch(
                """
                SELECT
                    r.id,
                    r.users_id,
                    r.source,
                    r.request,
                    r.content,
                    r.created_at,
                    r.cooked_at,
                    COALESCE(ch.cooking_count, 0)::INTEGER AS cooking_count,
                    COALESCE(ch.last_cooked_at, r.cooked_at) AS last_cooked_at,
                    EXISTS (
                        SELECT 1
                        FROM recipe_favourites f
                        WHERE f.users_id = r.users_id
                          AND f.recipe_id = r.id
                    ) AS is_favourite
                FROM recipes r
                LEFT JOIN (
                    SELECT recipe_id, users_id,
                           COUNT(*) AS cooking_count,
                           MAX(cooked_at) AS last_cooked_at
                    FROM recipe_cookings
                    GROUP BY recipe_id, users_id
                ) ch
                  ON ch.recipe_id = r.id
                 AND ch.users_id = r.users_id
                WHERE r.users_id = $1
                  AND r.id = ANY($2::INTEGER[])
                ORDER BY array_position($2::INTEGER[], r.id)
                """,
                user_id,
                recipe_ids,
            )

            recipes = []
            for row in rows:
                recipe = dict(row)
                recipe["content"] = _decode_json_value(recipe["content"])
                recipes.append(recipe)

            return {
                "message": "This generation request was already processed.",
                "recipes": recipes,
                "replayed": True,
            }

        # Recover a request left in 'processing' after a worker crash.
        reclaimed = await db.fetchrow(
            """
            UPDATE recipe_generation_requests
            SET started_at = NOW()
            WHERE users_id = $1
              AND idempotency_key = $2
              AND status = 'processing'
              AND started_at < NOW() - INTERVAL '15 minutes'
            RETURNING id
            """,
            user_id,
            idempotency_key,
        )

        if reclaimed is not None:
            return None

        raise HTTPException(
            status_code=409,
            detail="This recipe generation is already in progress. Please wait and retry with the same request.",
        )


async def _release_failed_generation_request(
    user_id: int,
    idempotency_key: UUID,
    db,
):
    """Remove a failed claim so the same client request can safely retry."""
    try:
        await db.execute(
            """
            DELETE FROM recipe_generation_requests
            WHERE users_id = $1
              AND idempotency_key = $2
              AND status = 'processing'
            """,
            user_id,
            idempotency_key,
        )
    except Exception as cleanup_error:
        print("GENERATION CLAIM CLEANUP ERROR:", repr(cleanup_error))


async def _generate_and_save_recipe_batch(
    *,
    user_id: int,
    items: list[dict],
    allergies: list[str],
    cuisine: list[str],
    diet: list[str],
    gluten_free: bool,
    source: str,
    generation_type: str,
    idempotency_key: UUID,
    db,
):
    """Generate and atomically save at most five recipes."""
    replay = await _claim_generation_request(
        user_id,
        idempotency_key,
        generation_type,
        db,
    )
    if replay is not None:
        return replay

    try:
        result = await generate_recipe_from_items(
            items,
            allergies,
            cuisine,
            diet,
            gluten_free,
        )

        recipes = result.get("recipes") if isinstance(result, dict) else None
        if not isinstance(recipes, list) or not recipes:
            raise HTTPException(
                status_code=502,
                detail="The AI did not return any recipes.",
            )

        # Hard server-side cap: one generation action stores no more than five.
        recipes = recipes[:5]
        saved_recipes = []

        async with db.transaction():
            for recipe in recipes:
                if not isinstance(recipe, dict):
                    raise HTTPException(
                        status_code=502,
                        detail="The AI returned an invalid recipe.",
                    )

                saved = await _save_recipe(
                    db=db,
                    user_id=user_id,
                    content=recipe,
                    source=source,
                    request=None,
                )
                saved_recipes.append(saved)

            recipe_ids = [int(recipe["id"]) for recipe in saved_recipes]
            await db.execute(
                """
                UPDATE recipe_generation_requests
                SET status = 'completed',
                    recipe_ids = $3::INTEGER[],
                    completed_at = NOW()
                WHERE users_id = $1
                  AND idempotency_key = $2
                """,
                user_id,
                idempotency_key,
                recipe_ids,
            )

        return {
            "message": "Recipes generated successfully.",
            "recipes": saved_recipes,
            "replayed": False,
        }

    except HTTPException:
        await _release_failed_generation_request(user_id, idempotency_key, db)
        raise
    except Exception as error:
        await _release_failed_generation_request(user_id, idempotency_key, db)
        print("RECIPE GENERATION ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not generate recipes. Please try again.",
        )


# ============================================================
# 4. GENERATE RECIPES FROM THE FULL FRIDGE
# ============================================================

async def generate_ai_recipe(
    user_id: int,
    idempotency_key: UUID,
    db,
):
    try:
        items, allergies, cuisine, diet, gluten_free = await _get_user_context(
            user_id, db
        )

        if not items:
            raise HTTPException(
                status_code=400,
                detail="Your fridge is empty. Add ingredients first.",
            )

        return await _generate_and_save_recipe_batch(
            user_id=user_id,
            items=items,
            allergies=allergies,
            cuisine=cuisine,
            diet=diet,
            gluten_free=gluten_free,
            source="ai",
            generation_type="fridge",
            idempotency_key=idempotency_key,
            db=db,
        )

    except HTTPException:
        raise
    except Exception as error:
        print("FRIDGE RECIPE GENERATION ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not generate recipes. Please try again.",
        )


# ============================================================
# 5. GENERATE RECIPES FROM ONLY USER-SELECTED INGREDIENTS
# ============================================================

async def generate_selected_recipes(
    user_id: int,
    ingredient_ids: list[int],
    idempotency_key: UUID,
    db,
):
    try:
        if not ingredient_ids:
            raise HTTPException(
                status_code=400,
                detail="Select at least one ingredient.",
            )

        if len(ingredient_ids) > 30:
            raise HTTPException(
                status_code=400,
                detail="Select no more than 30 ingredients at a time.",
            )

        if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in ingredient_ids):
            raise HTTPException(
                status_code=400,
                detail="Selected ingredient IDs must be positive integers.",
            )

        if len(set(ingredient_ids)) != len(ingredient_ids):
            raise HTTPException(
                status_code=400,
                detail="The selected ingredients contain duplicates.",
            )

        items, allergies, cuisine, diet, gluten_free = await _get_user_context(
            user_id, db
        )

        inventory_by_id = {
            int(item["ingredient_id"]): item
            for item in items
        }
        selected_ids = set(ingredient_ids)
        unavailable_ids = selected_ids.difference(inventory_by_id.keys())

        if unavailable_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Some selected ingredients are no longer in your fridge. "
                    "Refresh your inventory and try again."
                ),
            )

        # IMPORTANT: Only these selected inventory rows reach the AI service.
        selected_items = [
            inventory_by_id[ingredient_id]
            for ingredient_id in ingredient_ids
        ]

        return await _generate_and_save_recipe_batch(
            user_id=user_id,
            items=selected_items,
            allergies=allergies,
            cuisine=cuisine,
            diet=diet,
            gluten_free=gluten_free,
            source="selected",
            generation_type="selected",
            idempotency_key=idempotency_key,
            db=db,
        )

    except HTTPException:
        raise
    except Exception as error:
        print("SELECTED RECIPE GENERATION ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not generate recipes from the selected ingredients.",
        )


# ============================================================
# 4. GENERATE RECIPE FROM SEARCH
# ============================================================

async def generate_search_recipe(
    user_id: int,
    request: str,
    db,
):
    try:
        if not request or not request.strip():
            raise HTTPException(
                status_code=400,
                detail="Please provide a recipe search request.",
            )

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
            request.strip(),
            items,
            allergies,
            cuisine,
            diet,
            gluten_free,
        )

        recipe_content = result.get("recipe")
        if not isinstance(recipe_content, dict):
            raise HTTPException(
                status_code=502,
                detail="The AI did not return a valid recipe.",
            )

        async with db.transaction():
            saved = await _save_recipe(
                db=db,
                user_id=user_id,
                content=recipe_content,
                source="search",
                request=request.strip(),
            )

        return {
            "message": "Recipe generated successfully.",
            "recipe": saved,
        }

    except HTTPException:
        raise
    except Exception as error:
        print("SEARCH RECIPE ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not generate the requested recipe.",
        )


# ============================================================
# 5. GENERATE INGREDIENT EXPIRATION DATE
# ============================================================

async def generate_info(
    user_id: int,
    ingredient_id: int,
    db,
):
    """Estimate and save a date for an existing item that has no date yet."""
    item = await db.fetchrow(
        """
        SELECT
            items.id,
            items.expiration_date,
            global_ingredients.name
        FROM items
        JOIN global_ingredients
            ON items.ingredient_id = global_ingredients.id
        WHERE items.users_id = $1
          AND items.ingredient_id = $2
        """,
        user_id,
        ingredient_id,
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Ingredient not found.",
        )

    if item["expiration_date"] is not None:
        return {
            "ingredient_id": ingredient_id,
            "expiration_date": item["expiration_date"].isoformat(),
            "estimated_storage_life": None,
            "already_estimated": True,
        }

    try:
        expiration, duration_text = await estimate_expiration_date(item["name"])
    except (ValueError, TypeError) as error:
        print("EXPIRATION DATE PARSING ERROR:", repr(error))
        raise HTTPException(
            status_code=502,
            detail="Could not interpret the estimated storage duration.",
        )
    except Exception as error:
        print("EXPIRATION DATE ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not estimate the ingredient expiration date.",
        )

    await db.execute(
        """
        UPDATE items
        SET expiration_date = $1
        WHERE id = $2
          AND users_id = $3
        """,
        expiration,
        item["id"],
        user_id,
    )

    return {
        "ingredient_id": ingredient_id,
        "expiration_date": expiration.isoformat(),
        "estimated_storage_life": duration_text,
        "already_estimated": False,
    }


# ============================================================
# 7. COOK RECIPE (REPEATABLE + IDEMPOTENT)
# ============================================================

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

                    if previous["unit"] != unit:
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
                    "unit": needed["unit"],
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


# ============================================================
# 8. RETRIEVE USER'S RECIPES
# ============================================================

async def get_user_recipes_controller(user_id: int, db):
    try:
        rows = await db.fetch(
            """
            SELECT
                r.id,
                r.source,
                r.request,
                r.content,
                r.created_at,
                r.cooked_at,
                COALESCE(h.cooking_count, 0)::INTEGER AS cooking_count,
                COALESCE(h.last_cooked_at, r.cooked_at) AS last_cooked_at,
                EXISTS (
                    SELECT 1
                    FROM recipe_favourites f
                    WHERE f.recipe_id = r.id
                      AND f.users_id = r.users_id
                ) AS is_favourite
            FROM recipes r
            LEFT JOIN (
                SELECT
                    recipe_id,
                    users_id,
                    COUNT(*) AS cooking_count,
                    MAX(cooked_at) AS last_cooked_at
                FROM recipe_cookings
                GROUP BY recipe_id, users_id
            ) h
                ON h.recipe_id = r.id
               AND h.users_id = r.users_id
            WHERE r.users_id = $1
            ORDER BY r.created_at DESC, r.id DESC
            """,
            user_id,
        )

        recipes = []

        for row in rows:
            recipe = dict(row)
            recipe["content"] = _decode_json_value(recipe["content"])
            recipes.append(recipe)

        return {"recipes": recipes}

    except Exception as error:
        print("GET USER RECIPES ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve your recipes.",
        )


# ============================================================
# 9. RETRIEVE A RECIPE'S COOKING HISTORY
# ============================================================

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

# ============================================================
# 10. RECORD A RECIPE VIEW (KEEP THE 10 MOST RECENT UNIQUE RECIPES)
# ============================================================

async def record_recipe_view_controller(user_id: int, recipe_id: int, db):
    """Record that the user opened a recipe card; retain 10 unique recipes."""
    try:
        async with db.transaction():
            # Serialize view-history writes per user so concurrent taps cannot
            # leave more than ten rows behind.
            await db.execute(
                "SELECT pg_advisory_xact_lock(73111, $1::INTEGER)",
                user_id,
            )

            recipe = await db.fetchrow(
                """
                SELECT id
                FROM recipes
                WHERE id = $1 AND users_id = $2
                FOR KEY SHARE
                """,
                recipe_id,
                user_id,
            )

            if recipe is None:
                raise HTTPException(status_code=404, detail="Recipe not found.")

            viewed = await db.fetchrow(
                """
                INSERT INTO recipe_view_history (users_id, recipe_id, viewed_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (users_id, recipe_id)
                DO UPDATE SET viewed_at = NOW()
                RETURNING viewed_at
                """,
                user_id,
                recipe_id,
            )

            # Keep the ten most recently opened unique recipe cards.
            await db.execute(
                """
                DELETE FROM recipe_view_history h
                WHERE h.users_id = $1
                  AND h.recipe_id NOT IN (
                      SELECT recipe_id
                      FROM recipe_view_history
                      WHERE users_id = $1
                      ORDER BY viewed_at DESC, id DESC
                      LIMIT 10
                  )
                """,
                user_id,
            )

        return {
            "message": "Recipe view recorded.",
            "recipe_id": recipe_id,
            "viewed_at": viewed["viewed_at"],
        }

    except HTTPException:
        raise
    except Exception as error:
        print("RECORD RECIPE VIEW ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not update your recipe history.",
        )


# ============================================================
# 11. RETRIEVE THE USER'S LAST 10 VIEWED RECIPES
# ============================================================

async def get_recipe_view_history_controller(user_id: int, db):
    try:
        rows = await db.fetch(
            """
            SELECT
                r.id,
                r.source,
                r.request,
                r.content,
                r.created_at,
                r.cooked_at,
                vh.viewed_at,
                COALESCE(ch.cooking_count, 0)::INTEGER AS cooking_count,
                COALESCE(ch.last_cooked_at, r.cooked_at) AS last_cooked_at,
                EXISTS (
                    SELECT 1
                    FROM recipe_favourites f
                    WHERE f.recipe_id = r.id
                      AND f.users_id = r.users_id
                ) AS is_favourite
            FROM recipe_view_history vh
            JOIN recipes r
              ON r.id = vh.recipe_id
             AND r.users_id = vh.users_id
            LEFT JOIN (
                SELECT recipe_id, users_id,
                       COUNT(*) AS cooking_count,
                       MAX(cooked_at) AS last_cooked_at
                FROM recipe_cookings
                GROUP BY recipe_id, users_id
            ) ch
              ON ch.recipe_id = r.id
             AND ch.users_id = r.users_id
            WHERE vh.users_id = $1
            ORDER BY vh.viewed_at DESC, vh.id DESC
            LIMIT 10
            """,
            user_id,
        )

        history = []
        for row in rows:
            recipe = dict(row)
            recipe["content"] = _decode_json_value(recipe["content"])
            history.append(recipe)

        return {"history": history, "limit": 10}

    except Exception as error:
        print("GET RECIPE VIEW HISTORY ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve your recipe history.",
        )


# ============================================================
# 12. RETRIEVE THE USER'S LOVED RECIPES
# ============================================================

async def get_user_favourites_controller(user_id: int, db):
    try:
        rows = await db.fetch(
            """
            SELECT
                r.id,
                r.source,
                r.request,
                r.content,
                r.created_at,
                r.cooked_at,
                f.created_at AS favourited_at,
                COALESCE(ch.cooking_count, 0)::INTEGER AS cooking_count,
                COALESCE(ch.last_cooked_at, r.cooked_at) AS last_cooked_at,
                TRUE AS is_favourite
            FROM recipe_favourites f
            JOIN recipes r
              ON r.id = f.recipe_id
             AND r.users_id = f.users_id
            LEFT JOIN (
                SELECT recipe_id, users_id,
                       COUNT(*) AS cooking_count,
                       MAX(cooked_at) AS last_cooked_at
                FROM recipe_cookings
                GROUP BY recipe_id, users_id
            ) ch
              ON ch.recipe_id = r.id
             AND ch.users_id = r.users_id
            WHERE f.users_id = $1
            ORDER BY f.created_at DESC, f.recipe_id DESC
            """,
            user_id,
        )

        favourites = []
        for row in rows:
            recipe = dict(row)
            recipe["content"] = _decode_json_value(recipe["content"])
            favourites.append(recipe)

        return {"favourites": favourites}

    except Exception as error:
        print("GET USER FAVOURITES ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve your loved recipes.",
        )


# ============================================================
# 13. ADD A RECIPE TO LOVED ONES
# ============================================================

async def add_recipe_favourite_controller(user_id: int, recipe_id: int, db):
    try:
        async with db.transaction():
            recipe = await db.fetchrow(
                """
                SELECT id
                FROM recipes
                WHERE id = $1 AND users_id = $2
                FOR KEY SHARE
                """,
                recipe_id,
                user_id,
            )

            if recipe is None:
                raise HTTPException(status_code=404, detail="Recipe not found.")

            await db.execute(
                """
                INSERT INTO recipe_favourites (users_id, recipe_id)
                VALUES ($1, $2)
                ON CONFLICT (users_id, recipe_id) DO NOTHING
                """,
                user_id,
                recipe_id,
            )

        return {"recipe_id": recipe_id, "is_favourite": True}

    except HTTPException:
        raise
    except Exception as error:
        print("ADD RECIPE FAVOURITE ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not save this recipe.",
        )


# ============================================================
# 14. REMOVE A RECIPE FROM LOVED ONES
# ============================================================

async def remove_recipe_favourite_controller(user_id: int, recipe_id: int, db):
    try:
        recipe = await db.fetchrow(
            """
            SELECT id
            FROM recipes
            WHERE id = $1 AND users_id = $2
            """,
            recipe_id,
            user_id,
        )

        if recipe is None:
            raise HTTPException(status_code=404, detail="Recipe not found.")

        await db.execute(
            """
            DELETE FROM recipe_favourites
            WHERE users_id = $1 AND recipe_id = $2
            """,
            user_id,
            recipe_id,
        )

        return {"recipe_id": recipe_id, "is_favourite": False}

    except HTTPException:
        raise
    except Exception as error:
        print("REMOVE RECIPE FAVOURITE ERROR:", repr(error))
        raise HTTPException(
            status_code=500,
            detail="Could not remove this recipe from Loved ones.",
        )