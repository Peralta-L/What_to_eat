from uuid import UUID
from pydantic import BaseModel


class CookRecipeRequest(BaseModel):
    idempotency_key: UUID
