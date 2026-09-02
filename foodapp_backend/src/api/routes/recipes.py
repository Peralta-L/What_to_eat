from fastapi import APIRouter, Depends, HTTPException
from src.core.database import get_db
from src.utils.auth_util import get_current_user
from src.api.controllers.recipe_controller import ( save_recipe_controller, get_saved_recipes_controller, unsave_recipe_controller,
)

router = APIRouter()


@router.post("/recipes/save/{recipe_id}")
async def save_recipe(recipe_id: int, user_id: int = Depends(get_current_user), db=Depends(get_db)):
    try:
        return await save_recipe_controller(user_id, recipe_id, db)
    except HTTPException as e:
        raise e


@router.get("/recipes/saved")
async def get_saved_recipes(user_id: int = Depends(get_current_user), db=Depends(get_db)):
    try:
        return await get_saved_recipes_controller(user_id, db)
    except HTTPException as e:
        raise e


@router.delete("/recipes/saved/{recipe_id}")
async def unsave_recipe(recipe_id: int, user_id: int = Depends(get_current_user), db=Depends(get_db)):
    try:
        return await unsave_recipe_controller(user_id, recipe_id, db)
    except HTTPException as e:
        raise e