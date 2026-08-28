from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
import uvicorn
from src.api.routes import ai_food, auth
from src.core.database import get_db, connect_db, close_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()

app = FastAPI(lifespan=lifespan)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(ai_food.router, prefix="/api/ai_food", tags=["ai_food"])

@app.get("/")
def root():
    return {"message": "API is working!"}

@app.get("/health")
async def health(db=Depends(get_db)):
    return {"db": "connected"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000)