"""
Import the BLS 4.0 Excel food dataset into Neon/PostgreSQL.

Run from the foodapp_backend project root:
    python src/api/controllers/import_ingredients.py

Optional Excel file path:
    python src/api/controllers/import_ingredients.py "C:/path/to/BLS_4_0_Data_2025_EN.xlsx"

The import is safe to rerun: rows with an existing blscode are updated.
All nutritional values are stored per 100 g.
"""

import argparse
import asyncio
import os
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

import asyncpg
import pandas as pd
from dotenv import load_dotenv


# This file is expected at src/api/controllers/import_ingredients.py.
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_EXCEL_FILE = PROJECT_ROOT / "BLS_4_0_Data_2025_EN.xlsx"
load_dotenv(PROJECT_ROOT / ".env")

# Exact column names from the BLS 4.0 workbook.
EXCEL_TO_DB = {
    "BLS Code": "blscode",
    "Food name": "name",
    "ENERCC Energy (kilocalorie) [kcal/100g]": "calories",
    "FAT Fat [g/100g]": "fat",
    "FASAT Fatty acids, saturated, total [g/100g]": "saturated_fat",
    "CHO Carbohydrate, available [g/100g]": "carbs",
    "SUGAR Sugars (mono- and disaccharides), total [g/100g]": "sugars",
    "FIBT Fibre, dietary, total [g/100g]": "fiber",
    "PROT625 Protein (Nx6.25) [g/100g]": "protein",
    "NACL Salt (sodium chloride) [g/100g]": "salt",
}

INSERT_SQL = """
INSERT INTO global_ingredients (
    blscode,
    name,
    category,
    calories,
    fat,
    saturated_fat,
    carbs,
    sugars,
    fiber,
    protein,
    salt
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
)
ON CONFLICT (blscode) DO UPDATE SET
    name = EXCLUDED.name,
    calories = EXCLUDED.calories,
    fat = EXCLUDED.fat,
    saturated_fat = EXCLUDED.saturated_fat,
    carbs = EXCLUDED.carbs,
    sugars = EXCLUDED.sugars,
    fiber = EXCLUDED.fiber,
    protein = EXCLUDED.protein,
    salt = EXCLUDED.salt;
"""


def to_decimal(value: Any) -> Decimal | None:
    """Convert an Excel cell to Decimal; blanks and non-numeric markers become NULL."""
    if value is None or pd.isna(value):
        return None

    text = str(value).strip()
    if not text or text in {"-", "–", "—"}:
        return None

    # Decimal avoids introducing unnecessary floating-point rounding.
    try:
        number = Decimal(text.replace(",", "."))
        return number if number.is_finite() else None
    except (InvalidOperation, ValueError):
        # BLS cells can contain markers such as '<LOD or <LOQ'.
        return None


def build_records(excel_path: Path) -> tuple[list[tuple], int]:
    """Read the workbook and convert rows to asyncpg records."""
    if not excel_path.is_file():
        raise FileNotFoundError(
            f"Excel file not found: {excel_path}\n"
            "Put BLS_4_0_Data_2025_EN.xlsx in the foodapp_backend folder "
            "or pass its path as an argument."
        )

    df = pd.read_excel(excel_path, sheet_name=0, engine="openpyxl")

    missing_columns = [column for column in EXCEL_TO_DB if column not in df.columns]
    if missing_columns:
        raise ValueError(
            "The Excel file is missing expected columns:\n- "
            + "\n- ".join(missing_columns)
        )

    records = []
    skipped = 0

    for _, row in df.iterrows():
        blscode = row["BLS Code"]
        name = row["Food name"]

        if pd.isna(blscode) or pd.isna(name) or not str(name).strip():
            skipped += 1
            continue

        # The source workbook has no single matching food-category column,
        # so category is intentionally left NULL.
        records.append(
            (
                str(blscode).strip(),
                str(name).strip(),
                None,
                to_decimal(row["ENERCC Energy (kilocalorie) [kcal/100g]"]),
                to_decimal(row["FAT Fat [g/100g]"]),
                to_decimal(row["FASAT Fatty acids, saturated, total [g/100g]"]),
                to_decimal(row["CHO Carbohydrate, available [g/100g]"]),
                to_decimal(row["SUGAR Sugars (mono- and disaccharides), total [g/100g]"]),
                to_decimal(row["FIBT Fibre, dietary, total [g/100g]"]),
                to_decimal(row["PROT625 Protein (Nx6.25) [g/100g]"]),
                to_decimal(row["NACL Salt (sodium chloride) [g/100g]"]),
            )
        )

    return records, skipped


async def import_ingredients(excel_path: Path) -> None:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise EnvironmentError(
            "DATABASE_URL was not found. Check that your .env file is in "
            f"the project root: {PROJECT_ROOT}"
        )

    records, skipped = build_records(excel_path)
    if not records:
        print("No valid food rows were found. Nothing was imported.")
        return

    print(f"Excel file: {excel_path}")
    print(f"Valid food rows: {len(records)}")
    print(f"Skipped rows without a BLS code or food name: {skipped}")
    print("Connecting to Neon...")

    conn = await asyncpg.connect(dsn=database_url)
    try:
        # Import in batches to avoid sending the entire workbook in one request.
        batch_size = 500
        for start in range(0, len(records), batch_size):
            batch = records[start : start + batch_size]
            await conn.executemany(INSERT_SQL, batch)
            completed = min(start + len(batch), len(records))
            print(f"Processed {completed}/{len(records)}")

        total = await conn.fetchval("SELECT COUNT(*) FROM global_ingredients")
        print("\nImport completed successfully.")
        print(f"Rows processed: {len(records)}")
        print(f"Rows skipped: {skipped}")
        print(f"Total rows currently in global_ingredients: {total}")
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import BLS 4.0 nutritional data into global_ingredients."
    )
    parser.add_argument(
        "excel_file",
        nargs="?",
        type=Path,
        default=DEFAULT_EXCEL_FILE,
        help="Path to the BLS Excel workbook (defaults to the project root).",
    )
    args = parser.parse_args()

    asyncio.run(import_ingredients(args.excel_file.resolve()))


if __name__ == "__main__":
    main()
