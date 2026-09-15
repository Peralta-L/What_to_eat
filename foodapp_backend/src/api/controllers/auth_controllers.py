from asyncpg import UniqueViolationError
from fastapi import Depends, HTTPException
from src.schemas.login_schema import Login
from src.core.database import get_db
from src.utils.auth_util import hash_password, create_access_token, verify_password
from src.schemas.users_schema import Users

async def register(user: Users, db=Depends(get_db)):
    hashed_password = hash_password(user.password)

    if not hashed_password:
        raise HTTPException(status_code=500, detail="Error hashing password")
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    try:
        await db.execute("INSERT INTO users (name, lastname, username, email, password)VALUES ($1, $2, $3, $4, $5)", user.name, user.lastname, user.username, user.email, hashed_password)
    except UniqueViolationError as e:
        if "username" in str(e):
            raise HTTPException(status_code=400, detail="Username already exists")
        if "email" in str(e):
            raise HTTPException(status_code=400, detail="Email already exists")
        raise HTTPException(status_code=400, detail="Duplicate value")
    return {"message": "User registered successfully!"}

async def login(credentials: Login, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    user = await db.fetchrow("SELECT * FROM users WHERE username = $1 OR email = $1", credentials.user)
    
    print (user)  # Debugging line
    if not user:
        raise HTTPException(status_code=400, detail="Invalid username or password")
    
    if not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=400, detail="Invalid username or password")
    
    access_token = create_access_token({
        "sub": str(user["id"]), 
        "user_id": user["id"]
    })
    
    return {"access_token": access_token, "token_type": "bearer"}