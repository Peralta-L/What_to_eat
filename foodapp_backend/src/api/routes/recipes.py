from fastapi import APIRouter, Depends, HTTPException
from foodapp_backend.src.core.database import get_db

router = APIRouter()

@router.get("/recipes")
async def get_recipes(db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    recipes = await db.fetch("SELECT * FROM recipes")
    return {"recipes": [dict(recipe) for recipe in recipes]}

@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    recipe = await db.fetchrow("SELECT * FROM recipes WHERE id = $1", recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"recipe": dict(recipe)}

@router.get("/recipes/search")
async def search_recipes(query: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    recipes = await db.fetch("SELECT * FROM recipes WHERE name ILIKE $1", f"%{query}%")
    return {"recipes": [dict(recipe) for recipe in recipes]}

@router.get("/recipes/ingredient/{ingredient}")
async def get_recipes_by_ingredient(ingredient: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    recipes = await db.fetch("SELECT * FROM recipes WHERE ingredients ILIKE $1", f"%{ingredient}%")
    return {"recipes": [dict(recipe) for recipe in recipes]}
