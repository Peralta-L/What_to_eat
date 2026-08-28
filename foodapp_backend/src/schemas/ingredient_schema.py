from pydantic import BaseModel
from typing import Optional

class IngredientAdd(BaseModel):
    fdc_id:   int
    name:     str
    category: str
    calories: float
    protein:  float
    fat:      float
    carbs:    Optional[float] = None