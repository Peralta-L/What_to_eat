from fastapi import APIRouter, Depends
from src.api.controllers.ai_controller import generate_ai_recipe, generate_info, generate_search_recipe
from src.core.database import get_db

router = APIRouter()

@router.get("/generate-recipe")
async def generate_recipe(user_id: int, db=Depends(get_db)):
    return await generate_ai_recipe(user_id, db)

@router.get("/expiration-date/{ingredient_id}")
async def get_expiration_date(user_id: int, ingredient_id: int, db=Depends(get_db)):
    return await generate_info(user_id, ingredient_id, db)

@router.get("/search-recipes")
async def search_recipes(user_id: int, request: str, db=Depends(get_db)):
    return await generate_search_recipe(user_id, request, db)