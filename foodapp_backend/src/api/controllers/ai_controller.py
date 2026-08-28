from src.api.services.ai_service import generate_expiration_date, generate_recipe_from_items
from src.api.controllers.items_controllers import get_items_controller
from src.api.controllers.preferences_controller import get_allergies_controller, get_cuisine_controller, get_diet_controller, get_gluten_free_controller

async def generate_ai_recipe(user_id: int, db):
    result = await get_items_controller(user_id, db)
    items = [item["name"] for item in result["items"]]
    allergies = [allergy["allergies"] for allergy in await get_allergies_controller(user_id, db)]
    cuisine = [cuisine["cuisine_pref"] for cuisine in await get_cuisine_controller(user_id, db)]
    diet = [diet["diet_pref"] for diet in await get_diet_controller(user_id, db)]
    gluten_free = (await get_gluten_free_controller(user_id, db))["gluten_free"]
    return await generate_recipe_from_items(items, allergies, cuisine, diet, gluten_free)
    #will have to make a loop here since the ai will suggest not only one recipe but multiple recipes

async def generate_info(user_id: int, ingredient_id: int, db):
    name = await db.fetchvar("SELECT global_ingredients.name FROM items JOIN global_ingredients ON items.ingredient_id = global_ingredients.id WHERE items.users_id = $1", user_id)
    Info = await generate_expiration_date(name)
    await db.execute("INSERT INTO items (experation_date) values ($1) WHERE ingredient_id = $2 AND users_id = $3", Info["expiration_date"], ingredient_id, user_id)

async def generate_search_recipe(user_id: int, request: str, db):
    result = await get_items_controller(user_id, db)
    items = [item["name"] for item in result["items"]]
    allergies = [allergy["allergies"] for allergy in await get_allergies_controller(user_id, db)]
    cuisine = [cuisine["cuisine_pref"] for cuisine in await get_cuisine_controller(user_id, db)]
    diet = [diet["diet_pref"] for diet in await get_diet_controller(user_id, db)]
    gluten_free = (await get_gluten_free_controller(user_id, db))["gluten_free"]
    return await generate_search_recipe(request, items, allergies, cuisine, diet, gluten_free)
    # will have to make a loop here since the ai will suggest a recipe and if the user is missing more than 3 ingredients, it will suggest a different recipe until it finds one that the user can make with less than 3 missing ingredients.