from fastapi import APIRouter, Depends, HTTPException
from src.schemas.ingredient_schema import IngredientAdd
from src.api.controllers.ingredient_controllers import add_ingredient_controller, search_ingredient_controller
from src.core.database import get_db

router = APIRouter()

@router.get("/ingredients")
async def search_ingredients(ingredient: str = ..., db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await search_ingredient_controller(ingredient, db)    
    except HTTPException as e:
        raise e
    
@router.post("/ingredients")
async def add_ingredient(ingredient: IngredientAdd = ..., db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await add_ingredient_controller(ingredient, db)
        return {"message": "Ingredient added successfully"}
    except HTTPException as e:
        raise e