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
    record_recipe_view_controller,
    get_recipe_view_history_controller,
    get_user_favourites_controller,
    add_recipe_favourite_controller,
    remove_recipe_favourite_controller,
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


@router.get("/recipes/history")
async def get_recipe_view_history(
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await get_recipe_view_history_controller(user_id, db)


@router.post("/recipes/{recipe_id}/viewed")
async def record_recipe_view(
    recipe_id: int,
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await record_recipe_view_controller(user_id, recipe_id, db)


@router.get("/recipes/favourites")
async def get_user_favourites(
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await get_user_favourites_controller(user_id, db)


@router.post("/recipes/{recipe_id}/favourite")
async def add_recipe_favourite(
    recipe_id: int,
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await add_recipe_favourite_controller(user_id, recipe_id, db)


@router.delete("/recipes/{recipe_id}/favourite")
async def remove_recipe_favourite(
    recipe_id: int,
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await remove_recipe_favourite_controller(user_id, recipe_id, db)


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