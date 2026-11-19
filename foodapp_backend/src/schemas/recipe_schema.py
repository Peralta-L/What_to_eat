from uuid import UUID

from pydantic import BaseModel


class CookRecipeRequest(BaseModel):
    idempotency_key: UUID


class GenerateRecipesRequest(BaseModel):
    idempotency_key: UUID


class GenerateSelectedRecipesRequest(BaseModel):
    idempotency_key: UUID
    ingredient_ids: list[int]