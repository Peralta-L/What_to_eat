from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CookRecipeRequest(BaseModel):
    idempotency_key: UUID


class GenerateRecipesRequest(BaseModel):
    idempotency_key: UUID
    meal_type: Literal["breakfast", "lunch", "dinner"] = "lunch"
    count: int = Field(default=3, ge=1, le=5)


class GenerateSelectedRecipesRequest(BaseModel):
    idempotency_key: UUID
    ingredient_ids: list[int]
    meal_type: Literal["breakfast", "lunch", "dinner"] = "lunch"