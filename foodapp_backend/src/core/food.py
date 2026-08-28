import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    USDA_API_KEY: str = os.getenv("USDA_KEY")

settings = Settings()
