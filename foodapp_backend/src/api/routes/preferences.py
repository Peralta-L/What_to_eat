from fastapi import APIRouter, Depends

from src.core.database import get_db
from src.utils.auth_util import get_current_user
from src.schemas.preferences_schema import Preferences
from src.api.controllers.preferences_controller import (
    get_preferences_controller,
    update_preferences_controller,
)

router = APIRouter()


@router.get("")
async def get_preferences(user_id: int = Depends(get_current_user), db=Depends(get_db)):
    return await get_preferences_controller(user_id, db)


@router.put("")
async def update_preferences(
    prefs: Preferences,
    user_id: int = Depends(get_current_user),
    db=Depends(get_db),
):
    return await update_preferences_controller(user_id, prefs, db)