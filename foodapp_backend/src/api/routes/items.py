from fastapi import APIRouter, Depends, HTTPException
from src.core.database import get_db
from src.utils.auth_util import get_current_user
from src.api.controllers.items_controllers import (add_item_controller, get_items_controller, delete_item_controller, update_item_controller)

router = APIRouter()

@router.get("/items")
async def get_items(user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await get_items_controller(user_id, db)
    except HTTPException as e:
        raise e

@router.post("/items")
async def add_item(item: dict, user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await add_item_controller(user_id, item, db)
        return {"message": "Item added successfully"}
    except HTTPException as e:
        raise e

@router.delete("/items/{item_id}")
async def delete_item(item_id: int, user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await delete_item_controller(user_id, item_id, db)
        return {"message": "Item deleted successfully"}
    except HTTPException as e:
        raise e

@router.put("/items/{item_id}")
async def update_item(item_id: int, item: dict, user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await update_item_controller(user_id, item_id, item, db)
        return {"message": "Item updated successfully"}
    except HTTPException as e:
        raise e