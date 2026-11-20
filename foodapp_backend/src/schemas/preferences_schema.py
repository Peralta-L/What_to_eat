from pydantic import BaseModel, Field, field_validator


class Preferences(BaseModel):
    allergies: list[str] = Field(default_factory=list, max_length=50)
    cuisines: list[str] = Field(default_factory=list, max_length=30)
    diets: list[str] = Field(default_factory=list, max_length=30)
    gluten_free: bool = False

    @field_validator("allergies", "cuisines", "diets")
    @classmethod
    def clean(cls, values: list[str]) -> list[str]:
        cleaned = []
        for value in values:
            value = value.strip()[:60]
            if value and value not in cleaned:
                cleaned.append(value)
        return cleaned