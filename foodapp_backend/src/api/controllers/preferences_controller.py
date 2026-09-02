from fastapi.params import Depends
from fastapi import HTTPException
from src.core.database import get_db

async def get_allergies_controller(user_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    allergies = await db.fetch("SELECT allergies FROM preferences WHERE users_id = $1", user_id)
    return {"allergies": [allergy["allergies"] for allergy in allergies]}

async def get_cuisine_controller(user_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    cuisines = await db.fetch("SELECT cuisine_pref FROM preferences WHERE users_id = $1", user_id)
    return {"cuisines": [cuisine["cuisine_pref"] for cuisine in cuisines]}

async def get_diet_controller(user_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    diets = await db.fetch("SELECT diet_pref FROM preferences WHERE users_id = $1", user_id)
    return {"diets": [diet["diet_pref"] for diet in diets]}

async def get_gluten_free_controller(user_id: int, db=Depends(get_db)):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    gluten_free = await db.fetch("SELECT is_glutenfree FROM preferences WHERE users_id = $1", user_id)
    return {"gluten_free": gluten_free[0]["is_glutenfree"] if gluten_free else False}

async def update_preferences_controller(user_id, allergies, cuisines, diets, gluten_free, db):
    if not db:
        raise HTTPException(status_code=500, detail="Database connection error")
    await db.execute("DELETE FROM preferences WHERE users_id = $1", user_id)
    for allergy in allergies:
        await db.execute("INSERT INTO preferences (users_id, allergies) VALUES ($1, $2)", user_id, allergy)
    for cuisine in cuisines:
        await db.execute("INSERT INTO preferences (users_id, cuisine_pref) VALUES ($1, $2)", user_id, cuisine)
    for diet in diets:
        await db.execute("INSERT INTO preferences (users_id, diet_pref) VALUES ($1, $2)", user_id, diet)
    await db.execute("INSERT INTO preferences (users_id, is_glutenfree) VALUES ($1, $2)", user_id, gluten_free)
    return {"message": "Preferences updated successfully"}