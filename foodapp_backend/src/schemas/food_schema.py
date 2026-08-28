from pydantic import BaseModel

class Food(BaseModel):
    name: str
    category: str
    ingredients: str
    calories: int
    preparation_time: int
    dietary_restrictions: str