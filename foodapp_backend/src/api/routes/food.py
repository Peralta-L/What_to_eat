from fastapi import APIRouter, Depends, HTTPException
from src.core.database import get_db
from src.schemas.food_schema import Food
from src.api.controllers.food_controllers import add_food_controller, get_foods_controller, search_foods_controller, get_foods_by_category_controller, get_foods_by_ingredient_controller, get_foods_by_calories_controller, get_foods_by_preparation_time_controller, get_foods_by_dietary_restrictions_controller, get_foods_by_nutrient_controller

router = APIRouter()

@router.post("/foods")
async def add_food(user_id: int, food: Food, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await add_food_controller(user_id, food, db)
        return {"message": "Food added successfully"}
    except HTTPException as e:
        raise e

@router.get("/foods")
async def get_foods(user_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await get_foods_controller(user_id, db)
    except HTTPException as e:
        raise e

@router.get("/foods/search")
async def search_foods(user_id: int, query: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await search_foods_controller(user_id, query, db)
    except HTTPException as e:
        raise e

@router.get("/foods/category/{category}")
async def get_foods_by_category(user_id: int, category: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await get_foods_by_category_controller(user_id, category, db)
    except HTTPException as e:
        raise e

@router.get("/foods/ingredient/{ingredient}")
async def get_foods_by_ingredient(user_id: int, ingredient: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await get_foods_by_ingredient_controller(user_id, ingredient, db)
    except HTTPException as e:
        raise e

@router.get("/foods/calories")
async def get_foods_by_calories(user_id: int, max_calories: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await get_foods_by_calories_controller(user_id, max_calories, db)
    except HTTPException as e:
        raise e

@router.get("/foods/preparation_time")
async def get_foods_by_preparation_time(user_id: int, max_time: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await get_foods_by_preparation_time_controller(user_id, max_time, db)
    except HTTPException as e:
        raise e

@router.get("/foods/dietary_restriction/{restriction}")
async def get_foods_by_dietary_restriction(user_id: int, restriction: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await get_foods_by_dietary_restrictions_controller(user_id, restriction, db)
    except HTTPException as e:
        raise e

@router.get("/foods/nutrition/{nutrient}")
async def get_foods_by_nutrient(user_id: int, nutrient: str, min_amount: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await get_foods_by_nutrient_controller(user_id, nutrient, min_amount, db)
    except HTTPException as e:
        raise e