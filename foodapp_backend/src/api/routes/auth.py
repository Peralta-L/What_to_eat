from fastapi import APIRouter, Depends, HTTPException
from src.core.database import get_db
from src.schemas.users_schema import Users
from src.schemas.login_schema import Login
from src.api.controllers.auth_controllers import register, login
from src.utils.auth_util import get_current_user

router = APIRouter()

@router.post("/register")
async def register_route(user: Users, db=Depends(get_db)):
    try:
        return await register(user, db)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/login")
async def login_route(credentials: Login, db=Depends(get_db)):
    try:
        return await login(credentials.user, credentials.password, db)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/me")
async def me(user_id: int = Depends(get_current_user)):
    return {"user_id": user_id}

@router.get("/test")
def test():
    return {"auth": "ok"}