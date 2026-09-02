from fastapi import APIRouter, Depends, HTTPException
from src.utils.auth_util import get_current_user
from src.api.controllers.preferences_controller import get_allergies_controller, get_cuisine_controller, get_diet_controller, get_gluten_free_controller, update_preferences_controller, update_preferences_controller
from src.core.database import get_db

router = APIRouter()

@router.get("/allergies/")
async def get_allergies(user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await get_allergies_controller(user_id, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cuisine/")
async def get_cuisine(user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await get_cuisine_controller(user_id, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/diet/")
async def get_diet(user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await get_diet_controller(user_id, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/update/")
async def update_preferences(user_id: int = Depends(get_current_user), allergies: list[str] = [], cuisines: list[str] = [], diets: list[str] = [], gluten_free: bool = ..., db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await update_preferences_controller(user_id, allergies, cuisines, diets, gluten_free, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/gluten-free/")
async def get_gluten_free(user_id: int = Depends(get_current_user), db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        return await get_gluten_free_controller(user_id, db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))