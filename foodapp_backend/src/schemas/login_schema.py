from pydantic import BaseModel

class Login(BaseModel):
    user: str
    password: str