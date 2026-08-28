from pydantic import BaseModel

class Items(BaseModel):
    name: str
    quantity: int
    unit: str
    expiration_date: str
    