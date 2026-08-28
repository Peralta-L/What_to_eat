from fastapi import APIRouter, Depends, HTTPException
from src.core.database import get_db
from src.schemas.users_schema import Users
from src.api.controllers.auth_controllers import register, login

router = APIRouter()

@router.get("/register")
async def register_route(user: Users,db=Depends(get_db)):
    try:
        return await register(user, db)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    
@router.get("/login")
async def login_route(username: str, password: str, db=Depends(get_db)):
    try:
        return await login(username, password, db)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/test")
def test():
    return {"auth": "ok"}