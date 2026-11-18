from fastapi import APIRouter, Depends, Query

from src.core.database import get_db
from src.utils.auth_util import get_current_user
from src.schemas.recipe_schema import CookRecipeRequest

from src.api.controllers.ai_controller import (
    generate_ai_recipe,
    generate_info,
    generate_search_recipe,
    cook_recipe_controller,
    get_user_recipes_controller,
    get_recipe_cookings_controller,
)

router = APIRouter()


@router.get("/generate-recipe")
async def generate_recipe(
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await generate_ai_recipe(user_id, db)


@router.get("/search-recipes")
async def search_recipes(
    request: str = Query(..., min_length=3, max_length=200),
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await generate_search_recipe(user_id, request, db)


@router.get("/recipes")
async def get_user_recipes(
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await get_user_recipes_controller(user_id, db)


@router.get("/recipes/{recipe_id}/cookings")
async def get_recipe_cookings(
    recipe_id: int,
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await get_recipe_cookings_controller(
        user_id,
        recipe_id,
        db,
    )


@router.post("/recipes/{recipe_id}/cooked")
async def confirm_cooked_recipe(
    recipe_id: int,
    payload: CookRecipeRequest,
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await cook_recipe_controller(
        user_id,
        recipe_id,
        payload.idempotency_key,
        db,
    )


@router.get("/expiration-date/{ingredient_id}")
async def get_expiration_date(
    ingredient_id: int,
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await generate_info(user_id, ingredient_id, db)
