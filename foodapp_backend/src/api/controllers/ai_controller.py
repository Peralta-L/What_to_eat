from src.api.services.ai_service import (
    generate_expiration_date,
    generate_recipe_from_items,
    generate_search_recipe as generate_search_recipe_ai,
)

from src.api.controllers.items_controllers import get_items_controller

from src.api.controllers.preferences_controller import (get_allergies_controller, get_cuisine_controller, get_diet_controller, get_gluten_free_controller)


async def _get_user_context(user_id: int, db):
    """Shared lookup used by both recipe-generation flows."""
    result = await get_items_controller(user_id, db)
    items = [item["name"] for item in result["items"]]

    allergies = (await get_allergies_controller(user_id, db))["allergies"]
    cuisine = (await get_cuisine_controller(user_id, db))["cuisines"]
    diet = (await get_diet_controller(user_id, db))["diets"]
    gluten_free = (await get_gluten_free_controller(user_id, db))["gluten_free"]

    return items, allergies, cuisine, diet, gluten_free


async def _save_recipe(db, content: str, source: str = "ai", request: str | None = None) -> dict:
    """Insert AI output into the recipes table so it can be saved/favorited later."""
    row = await db.fetchrow(
        "INSERT INTO recipes (source, request, content) VALUES ($1, $2, $3) RETURNING id, content",
        source,
        request,
        content,
    )
    return dict(row)


async def generate_ai_recipe(user_id: int, db):
    items, allergies, cuisine, diet, gluten_free = await _get_user_context(user_id, db)
    content = await generate_recipe_from_items(items, allergies, cuisine, diet, gluten_free)
    return await _save_recipe(db, content)
    # will have to make a loop here since the ai will suggest not only one recipe but multiple recipes


async def generate_info(user_id: int, ingredient_id: int, db):
    name = await db.fetchval(
        "SELECT global_ingredients.name FROM items JOIN global_ingredients ON items.ingredient_id = global_ingredients.id WHERE items.users_id = $1 AND items.ingredient_id = $2",
        user_id,
        ingredient_id,
    )
    expiration = await generate_expiration_date(name)
    await db.execute(
        "UPDATE items SET experation_date = $1 WHERE ingredient_id = $2 AND users_id = $3",
        expiration,
        ingredient_id,
        user_id,
    )
    return {"expiration": expiration}


async def generate_search_recipe(user_id: int, request: str, db):
    items, allergies, cuisine, diet, gluten_free = await _get_user_context(user_id, db)
    content = await generate_search_recipe_ai(request, items, allergies, cuisine, diet, gluten_free)
    return await _save_recipe(db, content, request=request)
    # will have to make a loop here since the ai will suggest a recipe and if the user is missing more than 3 ingredients, it will suggest a different recipe until it finds one that the user can make with less than 3 missing ingredients.