from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from src.api.routes import ai_food, auth, items, food, ingredient, preferences, recipes
from src.core.database import get_db, connect_db, close_db

@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_db()
    yield
    await close_db()

app = FastAPI(lifespan=lifespan)

# Allow your Expo frontend (running on a different origin/port) to call this API.
# Tighten allow_origins to your actual frontend URL(s) before shipping to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(ai_food.router, prefix="/api/ai_food", tags=["ai_food"])

# These routers already define their resource name in each path
# (e.g. items.py has @router.get("/items")), so the prefix stays just "/api"
# to avoid ending up with doubled paths like /api/items/items.
app.include_router(items.router, prefix="/api", tags=["items"])
app.include_router(food.router, prefix="/api", tags=["food"])
app.include_router(ingredient.router, prefix="/api", tags=["ingredient"])
app.include_router(recipes.router, prefix="/api", tags=["recipes"])

# preferences.py's routes (/allergies/, /cuisine/, etc.) do NOT include
# "preferences" themselves, so this prefix supplies it.
app.include_router(preferences.router, prefix="/api/preferences", tags=["preferences"])

@app.get("/")
def root():
    return {"message": "API is working!"}

@app.get("/health")
async def health(db=Depends(get_db)):
    return {"db": "connected"}


if __name__ == "__main__":
    uvicorn.run("main:app", reload=True, host="0.0.0.0", port=8000)