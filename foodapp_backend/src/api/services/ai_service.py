from src.core.ai_client import client

async def generate_recipe_from_items(items: list[str], allergies: list[str], cuisine: list[str], diet: list[str], gluten_free: bool = False):
    prompt = f"""
    The user has these ingredients: {", ".join(items)}.
    They have the following restrictions that it MUSS be followed: {", ".join(allergies)}, {", ".join(diet)}, {"gluten-free" if gluten_free else "not gluten-free"}.
    They have an inclination towards this cuisine: {", ".join(cuisine)}.
    Suggest as many recipes as possible they can make with these ingredients only.
    Include:
    - recipe name
    - description
    - generated image (if possible)
    - ingredients list
    - steps to make the recipe
    - dietary information (calories, macros, etc.)
    - dietary suitability (e.g., vegan, gluten-free, etc.)
    """

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content

async def generate_expiration_date(item_name: str):
    prompt = f"""
    What is the typical expiration date for {item_name} when stored properly?
    Provide the answer in a concise format (e.g., "1 week", "3 months").
    """

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content

async def generate_search_recipe(request: str, items: list[str], allergies: list[str], cuisine: list[str], diet: list[str], gluten_free: bool = False):
    prompt = f"""
    The user has these ingredients: {", ".join(items)}.
    They have the following restrictions that it MUST be followed: {", ".join(allergies)}, {", ".join(diet)}, {"gluten-free" if gluten_free else "not gluten-free"}.
    They have an inclination towards this cuisine: {", ".join(cuisine)}.
    They are looking for recipes that match this request: "{request}".
    Suggest the recipe that best matches the user's request and display what ingredients the user is missing, if any.
    if the user is missing more than 3 ingredients, suggest a different recipe that better matches the user's request and has less missing ingredients.
    include:
    - recipe name
    - description
    - generated image (if possible)
    - ingredients list (highlighting missing ingredients)
    - steps to make the recipe
    - dietary information (calories, macros, etc.)
    - dietary suitability (e.g., vegan, gluten-free, etc.)
    """

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}]
    )

    return response.choices[0].message.content