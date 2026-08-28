from asyncpg import UniqueViolationError
from fastapi import Depends, HTTPException
from src.core.database import get_db

async def get_items_controller(users_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    items = await db.fetch("SELECT global_ingredients.name, global_ingredients.category, items.quantity, items.unit, global_ingredients.protein, global_ingredients.carbs, global_ingredients.fat, global_ingredients.calories FROM items JOIN global_ingredients ON items.ingredient_id = global_ingredients.id WHERE items.users_id = $1", users_id)
    return {"items": [dict(item) for item in items]}

async def add_item_controller(users_id: int, item: dict, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await db.execute("INSERT INTO items (ingredient_id, quantity, unit, users_id) VALUES ($1, $2, $3, $4)", item["ingredient_id"], item["quantity"], item["unit"], users_id)

    except UniqueViolationError:
        raise HTTPException(status_code=400, detail="Item already exists")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

async def delete_item_controller(users_id: int, item_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await db.execute("DELETE FROM items WHERE id = $1 AND users_id = $2", item_id, users_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

async def update_item_controller(users_id: int, item_id: int, item: dict, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await db.execute("UPDATE items SET ingredient_id = $1, quantity = $2, unit = $3 WHERE id = $4 AND users_id = $5", item["ingredient_id"], item["quantity"], item["unit"], item_id, users_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))