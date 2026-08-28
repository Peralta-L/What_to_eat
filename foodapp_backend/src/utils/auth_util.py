from passlib.context import CryptContext
from jose import jwt
from fastapi.security import OAuth2PasswordBearer
from fastapi import  HTTPException, status, Depends, JWTError
import os

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


async def hash_password(password: str):
    return pwd_context.hash(password)

async def create_access_token(data: dict):
    return jwt.encode(data, os.getenv("SECRET_KEY"), algorithm="HS256")

async def verify_password(plain_password: str, hashed_password: str):
    return pwd_context.verify(plain_password, hashed_password)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, os.getenv("SECRET_KEY"), algorithms=["HS256"])
        user_id: int = payload.get("user_id")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    return user_id