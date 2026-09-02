from asyncpg import UniqueViolationError
from fastapi import Depends, HTTPException
from src.core.database import get_db
from src.schemas.food_schema import Food

async def add_food_controller(user_id: int, food: Food, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:        
        await db.execute("INSERT INTO foods (name, category, ingredients, calories, preparation_time, dietary_restrictions, users_id) VALUES ($1, $2, $3, $4, $5, $6, $7)", food.name, food.category, food.ingredients, food.calories, food.preparation_time, food.dietary_restrictions, user_id)
        return {"message": "Food added successfully"}
    except UniqueViolationError as e:
        if "name" in str(e):
            raise HTTPException(status_code=400, detail="Food name already exists")
        raise HTTPException(status_code=400, detail="Duplicate value")

async def get_foods_controller(user_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE users_id = $1", user_id)
    return {"foods": [dict(food) for food in foods]}

async def get_foods_by_category_controller(user_id: int, category: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE category ILIKE $1 AND users_id = $2", f"%{category}%", user_id)
    return {"foods": [dict(food) for food in foods]}

async def get_foods_by_ingredient_controller(user_id: int, ingredient: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE ingredients ILIKE $1 AND users_id = $2", f"%{ingredient}%", user_id)
    return {"foods": [dict(food) for food in foods]}

async def get_foods_by_calories_controller(user_id: int, max_calories: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE calories <= $1 AND users_id = $2", max_calories, user_id)
    return {"foods": [dict(food) for food in foods]}

async def get_foods_by_preparation_time_controller(user_id: int, max_time: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE preparation_time <= $1 AND users_id = $2", max_time, user_id)
    return {"foods": [dict(food) for food in foods]}

async def get_foods_by_dietary_restrictions_controller(user_id: int, restrictions: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE dietary_restrictions ILIKE $1 AND users_id = $2", f"%{restrictions}%", user_id)
    return {"foods": [dict(food) for food in foods]}

async def get_foods_by_nutrient_controller(user_id: int, nutrient: str, min_amount: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE nutrition ->> $1 >= $2 AND users_id = $3", nutrient, str(min_amount), user_id)
    return {"foods": [dict(food) for food in foods]}

async def search_foods_controller(user_id: int, query: str, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    foods = await db.fetch("SELECT * FROM foods WHERE name ILIKE $1 AND users_id = $2", f"%{query}%", user_id)
    return {"foods": [dict(food) for food in foods]}