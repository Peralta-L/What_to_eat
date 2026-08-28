import httpx
from src.core.food import settings

BASE_URL = "https://api.nal.usda.gov/fdc/v1"

async def search_ingredients(query: str):
    url = f"{BASE_URL}/foods/search?query={query}&api_key={settings.USDA_API_KEY}"

    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def get_food(fdc_id: int):
    url = f"{BASE_URL}/food/{fdc_id}?api_key={settings.USDA_API_KEY}"

    async with httpx.AsyncClient() as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
