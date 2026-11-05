from fastapi import APIRouter
from src.api.controllers.ingredient_controllers import (search_ingredient_controller)

router = APIRouter()

@router.get("/ingredients")
async def search_ingredients(
    ingredient: str
):
    return await search_ingredient_controller(ingredient)