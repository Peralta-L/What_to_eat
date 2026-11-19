"""Shared expiry-date estimation helpers used when items are added and on Calendar."""

import calendar
import re
from datetime import date, timedelta

from src.api.services.ai_service import generate_expiration_date


def storage_life_to_date(duration_text: str, start_date: date | None = None) -> date:
    """Convert an AI duration such as '7 days' or '2 weeks' into a date."""
    if not isinstance(duration_text, str):
        raise ValueError("The AI did not return a storage duration.")

    match = re.search(
        r"\b(\d+)\s*(days?|weeks?|months?|years?)\b",
        duration_text.strip().lower(),
    )
    if not match:
        raise ValueError(f"Unrecognized storage duration: {duration_text!r}")

    amount = int(match.group(1))
    unit = match.group(2)
    if amount <= 0:
        raise ValueError("Storage duration must be positive.")

    base = start_date or date.today()

    if unit.startswith("day"):
        return base + timedelta(days=amount)
    if unit.startswith("week"):
        return base + timedelta(weeks=amount)
    if unit.startswith("month"):
        month_index = base.month - 1 + amount
        year = base.year + month_index // 12
        month = month_index % 12 + 1
        day = min(base.day, calendar.monthrange(year, month)[1])
        return date(year, month, day)

    year = base.year + amount
    day = min(base.day, calendar.monthrange(year, base.month)[1])
    return date(year, base.month, day)


async def estimate_expiration_date(
    ingredient_name: str,
    start_date: date | None = None,
) -> tuple[date, str]:
    """Ask the existing AI service for a duration and convert it to a date."""
    duration_text = await generate_expiration_date(ingredient_name)
    expiration = storage_life_to_date(duration_text, start_date=start_date)
    return expiration, duration_text
