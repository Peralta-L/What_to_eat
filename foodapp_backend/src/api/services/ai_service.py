import json
import math

from src.core.ai_client import client


MODEL = "openai/gpt-oss-120b"

# Schema for recipes generated using fridge ingredients
RECIPES_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "recipes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "cooking_time": {"type": "integer"},
                    "difficulty": {"type": "string"},
                    "servings": {"type": "integer"},
                    "image_url": {
                        "anyOf": [
                            {"type": "string"},
                            {"type": "null"}
                        ]
                    },
                    "ingredients": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "ingredient_id": {"type": "integer"},
                                "name": {"type": "string"},
                                "quantity": {"type": "number"},
                                "unit": {"type": "string"}
                            },
                            "required": [
                                "ingredient_id",
                                "name",
                                "quantity",
                                "unit"
                            ],
                            "additionalProperties": False
                        }
                    },
                    "instructions": {
                        "type": "array",
                        "items": {"type": "string"}
                    },
                    "nutrition": {
                        "type": "object",
                        "properties": {
                            "calories": {"type": "number"},
                            "protein": {"type": "number"},
                            "carbs": {"type": "number"},
                            "fat": {"type": "number"}
                        },
                        "required": [
                            "calories",
                            "protein",
                            "carbs",
                            "fat"
                        ],
                        "additionalProperties": False
                    }
                },
                "required": [
                    "title",
                    "description",
                    "cooking_time",
                    "difficulty",
                    "servings",
                    "image_url",
                    "ingredients",
                    "instructions",
                    "nutrition"
                ],
                "additionalProperties": False
            }
        }
    },
    "required": ["recipes"],
    "additionalProperties": False
}


# Schema for recipes generated from a search request
SEARCH_RECIPE_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "recipe": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "cooking_time": {"type": "integer"},
                "difficulty": {"type": "string"},
                "servings": {"type": "integer"},
                "image_url": {
                    "anyOf": [
                        {"type": "string"},
                        {"type": "null"}
                    ]
                },
                "ingredients": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "ingredient_id": {
                                "anyOf": [
                                    {"type": "integer"},
                                    {"type": "null"}
                                ]
                            },
                            "name": {"type": "string"},
                            "quantity": {"type": "number"},
                            "unit": {"type": "string"},
                            "is_available": {"type": "boolean"}
                        },
                        "required": [
                            "ingredient_id",
                            "name",
                            "quantity",
                            "unit",
                            "is_available"
                        ],
                        "additionalProperties": False
                    }
                },
                "instructions": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "nutrition": {
                    "type": "object",
                    "properties": {
                        "calories": {"type": "number"},
                        "protein": {"type": "number"},
                        "carbs": {"type": "number"},
                        "fat": {"type": "number"}
                    },
                    "required": [
                        "calories",
                        "protein",
                        "carbs",
                        "fat"
                    ],
                    "additionalProperties": False
                }
            },
            "required": [
                "title",
                "description",
                "cooking_time",
                "difficulty",
                "servings",
                "image_url",
                "ingredients",
                "instructions",
                "nutrition"
            ],
            "additionalProperties": False
        }
    },
    "required": ["recipe"],
    "additionalProperties": False
}


def _prepare_inventory(items: list[dict]) -> list[dict]:
    """Prepare inventory data for the AI prompt."""

    inventory = []

    for item in items:
        inventory.append({
            "ingredient_id": int(item["ingredient_id"]),
            "name": item["name"],
            "quantity": float(item["quantity"]),
            "unit": item["unit"],
        })

    return inventory



def _call_ai_json(
    prompt: str,
    schema_name: str,
    schema: dict,
) -> dict:
    """Generate a response using Groq Strict Structured Outputs."""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a professional cooking assistant. "
                    "Generate accurate, realistic recipes. "
                    "Follow the requested JSON structure exactly."
                ),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": True,
                "schema": schema,
            },
        },
    )

    content = response.choices[0].message.content

    if not content:
        raise ValueError("The AI returned an empty response.")

    try:
        result = json.loads(content)
    except json.JSONDecodeError as error:
        raise ValueError(
            f"The AI returned invalid JSON: {error}"
        ) from error

    if not isinstance(result, dict):
        raise ValueError("The AI response must be a JSON object.")

    return result



def _validate_inventory_ingredients(
    recipes: list[dict],
    inventory: list[dict],
) -> list[dict]:
    """
    Validate that every recipe ingredient exists in the user's
    inventory and uses an available quantity and matching unit.
    """

    inventory_by_id = {
        item["ingredient_id"]: item
        for item in inventory
    }

    for recipe in recipes:
        for ingredient in recipe.get("ingredients", []):

            ingredient_id = ingredient.get("ingredient_id")

            if ingredient_id is None:
                raise ValueError(
                    "A fridge-only recipe contains an unknown ingredient."
                )

            try:
                ingredient_id = int(ingredient_id)
            except (ValueError, TypeError):
                raise ValueError("Invalid ingredient ID in recipe.")

            if ingredient_id not in inventory_by_id:
                raise ValueError(
                    f"Ingredient ID {ingredient_id} is not in the inventory."
                )

            stock = inventory_by_id[ingredient_id]

            if ingredient.get("unit") != stock["unit"]:
                raise ValueError(
                    f"Unit mismatch for {stock['name']}."
                )

            try:
                quantity = float(ingredient["quantity"])
            except (ValueError, TypeError, KeyError):
                raise ValueError(
                    f"Invalid quantity for {stock['name']}."
                )

            if not math.isfinite(quantity) or quantity <= 0:
                raise ValueError(
                    f"Invalid quantity for {stock['name']}."
                )

            if quantity > stock["quantity"]:
                raise ValueError(
                    f"Recipe requires more {stock['name']} than available."
                )

    return recipes


async def generate_recipe_from_items(
    items: list[dict],
    allergies: list[str],
    cuisine: list[str],
    diet: list[str],
    gluten_free: bool = False,
):
    """Generate multiple recipes using the user's actual inventory."""

    inventory = _prepare_inventory(items)

    if not inventory:
        raise ValueError("Your inventory is empty.")

    prompt = f"""
You are an expert chef and recipe recommendation assistant.

The user has the following ingredients in their fridge:

{json.dumps(inventory, indent=2)}

USER PREFERENCES:

Allergies: {json.dumps(allergies)}
Preferred cuisines: {json.dumps(cuisine)}
Dietary preferences: {json.dumps(diet)}
Gluten-free requirement: {gluten_free}

TASK:

Generate up to 8 different recipes that the user can prepare
using ONLY the ingredients listed in their inventory.

IMPORTANT RULES:

1. Never invent ingredients.
2. Every ingredient must use its exact ingredient_id from the inventory.
3. Every ingredient must use the same unit as its inventory entry.
4. Never require more of an ingredient than the available quantity.
5. Recipe quantities must be positive numbers.
6. Respect ALL allergies and dietary restrictions.
7. Prefer recipes that use ingredients efficiently.
8. Recipes should be varied and realistic.
9. Do not include optional ingredients that are not in the inventory.
10. If there are not enough ingredients for 8 recipes, return fewer.
11. Nutrition values should be estimates, not guaranteed laboratory values.

RETURN ONLY JSON IN THIS FORMAT:

{{
    "recipes": [
        {{
            "title": "Recipe name",
            "description": "Short description",
            "cooking_time": 25,
            "difficulty": "Easy",
            "servings": 2,
            "image_url": null,
            "ingredients": [
                {{
                    "ingredient_id": 12,
                    "name": "Pasta",
                    "quantity": 200,
                    "unit": "g"
                }}
            ],
            "instructions": [
                "First cooking step",
                "Second cooking step"
            ],
            "nutrition": {{
                "calories": 450,
                "protein": 15,
                "carbs": 65,
                "fat": 12
            }}
        }}
    ]
}}
"""

    result = _call_ai_json(
    prompt,
    "fridge_recipes",
    RECIPES_RESPONSE_SCHEMA,
)

    recipes = result.get("recipes")

    if not isinstance(recipes, list) or not recipes:
        raise ValueError("The AI did not generate any valid recipes.")

    if len(recipes) > 8:
        recipes = recipes[:8]

    return {
        "recipes": _validate_inventory_ingredients(
            recipes,
            inventory,
        )
    }


async def generate_expiration_date(item_name: str):
    """Estimate the typical storage life of an ingredient."""

    prompt = f"""
What is the typical expiration or storage life of {item_name}
when stored properly?

Return a concise answer, for example:
"1 week" or "3 months".
"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
    )

    return response.choices[0].message.content.strip()


async def generate_search_recipe(
    request: str,
    items: list[dict],
    allergies: list[str],
    cuisine: list[str],
    diet: list[str],
    gluten_free: bool = False,
):
    """Generate one recipe matching a user's search request."""

    inventory = _prepare_inventory(items)

    prompt = f"""
You are an expert chef and recipe recommendation assistant.

USER'S REQUEST:
{request}

AVAILABLE INVENTORY:
{json.dumps(inventory, indent=2)}

USER PREFERENCES:

Allergies: {json.dumps(allergies)}
Preferred cuisines: {json.dumps(cuisine)}
Dietary preferences: {json.dumps(diet)}
Gluten-free requirement: {gluten_free}

TASK:

Generate the recipe that best matches the user's request.

RULES:

1. Respect all allergies and dietary restrictions.
2. Use available ingredients whenever possible.
3. For available ingredients, use their exact ingredient_id
   and exact inventory unit.
4. Never require more of an available ingredient than the
   user's current stock.
5. For missing ingredients, use ingredient_id: null
   and is_available: false.
6. Never pretend a missing ingredient is available.
7. If more than 3 ingredients are missing, prefer a
   different recipe with fewer missing ingredients.
8. Do not silently substitute an allergen.
9. Nutrition information should be estimated.

RETURN ONLY JSON IN THIS FORMAT:

{{
    "recipe": {{
        "title": "Recipe name",
        "description": "Short description",
        "cooking_time": 30,
        "difficulty": "Medium",
        "servings": 2,
        "image_url": null,
        "ingredients": [
            {{
                "ingredient_id": 12,
                "name": "Pasta",
                "quantity": 200,
                "unit": "g",
                "is_available": true
            }},
            {{
                "ingredient_id": null,
                "name": "Parmesan",
                "quantity": 30,
                "unit": "g",
                "is_available": false
            }}
        ],
        "instructions": [
            "First cooking step",
            "Second cooking step"
        ],
        "nutrition": {{
            "calories": 450,
            "protein": 15,
            "carbs": 65,
            "fat": 12
        }}
    }}
}}
"""

    result = _call_ai_json(
    prompt,
    "searched_recipe",
    SEARCH_RECIPE_RESPONSE_SCHEMA,
)

    recipe = result.get("recipe")

    if not isinstance(recipe, dict):
        raise ValueError("The AI did not return a valid recipe.")

    # Validate only ingredients marked as available.
    available_ingredients = [
        ingredient
        for ingredient in recipe.get("ingredients", [])
        if ingredient.get("is_available") is True
    ]

    _validate_inventory_ingredients(
        [{"ingredients": available_ingredients}],
        inventory,
    )

    return {"recipe": recipe}
