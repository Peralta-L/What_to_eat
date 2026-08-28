from pydantic import BaseModel

class Users(BaseModel):
    name: str
    lastname: str
    username: str
    email: str
    password: str
