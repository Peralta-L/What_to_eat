from fastapi import Depends, FastAPI
import uvicorn
from src.api.routes import ai_food, auth
from src.core.database import get_db

app = FastAPI()

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(ai_food.router, prefix="/api/ai_food", tags=["ai_food"])

@app.get("/")
def root():
    return {"message": "API is working!"}

@app.get("/health")
async def health(db=Depends(get_db)):
    return {"db": "connected"}

@app.post("/test-add-item")
async def test_add_item(name: str, db=Depends(get_db)):
    await db.execute("INSERT INTO items (name) VALUES ($1)", name)
    return {"added": name}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000)