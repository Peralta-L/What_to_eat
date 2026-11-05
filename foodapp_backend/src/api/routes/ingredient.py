from fastapi import APIRouter, Depends, HTTPException
from src.schemas.ingredient_schema import IngredientAdd
from src.api.controllers.ingredient_controllers import search_ingredients
from src.core.database import get_db

router = APIRouter()

@router.get("/ingredients")
async def search_ingredients(ingredient: str = ..., db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await search_ingredients(ingredient, db)    
    except HTTPException as e:
        raise e