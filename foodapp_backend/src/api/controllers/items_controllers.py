from asyncpg import UniqueViolationError
from fastapi import Depends, HTTPException

from src.core.database import get_db


VALID_STORAGE_LOCATIONS = {"fridge", "freezer", "dry"}


def _validate_storage_location(value):
    location = value or "fridge"
    if not isinstance(location, str) or location not in VALID_STORAGE_LOCATIONS:
        raise HTTPException(
            status_code=400,
            detail="Storage location must be 'fridge', 'freezer', or 'dry'.",
        )
    return location


async def get_items_controller(users_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")

    items = await db.fetch(
        """
        SELECT
            items.id,
            items.ingredient_id,
            items.quantity,
            items.unit,
            items.storage_location,
            items.experation_date AS expiration_date,
            global_ingredients.name,
            global_ingredients.category,
            global_ingredients.calories,
            global_ingredients.fat,
            global_ingredients.saturated_fat,
            global_ingredients.carbs,
            global_ingredients.sugars,
            global_ingredients.fiber,
            global_ingredients.protein,
            global_ingredients.salt
        FROM items
        JOIN global_ingredients
            ON items.ingredient_id = global_ingredients.id
        WHERE items.users_id = $1
        ORDER BY global_ingredients.name
        """,
        users_id,
    )
    return {"items": [dict(item) for item in items]}


async def add_item_controller(users_id: int, item: dict, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")

    storage_location = _validate_storage_location(item.get("storage_location", "fridge"))

    try:
        await db.execute(
            """
            INSERT INTO items (
                ingredient_id,
                quantity,
                unit,
                users_id,
                storage_location
            )
            VALUES ($1, $2, $3, $4, $5)
            """,
            item["ingredient_id"],
            item["quantity"],
            item["unit"],
            users_id,
            storage_location,
        )
    except UniqueViolationError:
        raise HTTPException(status_code=400, detail="Item already exists")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))


async def delete_item_controller(users_id: int, item_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")

    try:
        await db.execute(
            "DELETE FROM items WHERE id = $1 AND users_id = $2",
            item_id,
            users_id,
        )
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))


async def update_item_controller(users_id: int, item_id: int, item: dict, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")

    storage_location = item.get("storage_location")
    if storage_location is not None:
        storage_location = _validate_storage_location(storage_location)

    try:
        await db.execute(
            """
            UPDATE items
            SET
                ingredient_id = $1,
                quantity = $2,
                unit = $3,
                storage_location = COALESCE($4, storage_location)
            WHERE id = $5
              AND users_id = $6
            """,
            item["ingredient_id"],
            item["quantity"],
            item["unit"],
            storage_location,
            item_id,
            users_id,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error))