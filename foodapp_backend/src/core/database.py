import os
from pathlib import Path
import asyncpg
from dotenv import load_dotenv

load_dotenv()

pool: asyncpg.Pool | None = None


async def connect_db():
    """Call this once on FastAPI startup (e.g. in a startup event/lifespan)."""
    global pool
    pool = await asyncpg.create_pool(dsn=os.environ["DATABASE_URL"])
    print("Database pool connected")

async def close_db():
    """Call this once on FastAPI shutdown."""
    if pool:
        await pool.close()
        print("Database pool closed")


async def get_db():
    """FastAPI dependency: db=Depends(get_db) hands each request its own connection."""
    async with pool.acquire() as connection:
        yield connection


async def run_schema():
    """Run once (e.g. python -m src.core.database) to create all tables in Neon."""
    schema_path = Path(__file__).parent.parent / "sql" / "schema.sql"
    schema_sql = schema_path.read_text()

    conn = await asyncpg.connect(dsn=os.environ["DATABASE_URL"])
    try:
        await conn.execute(schema_sql)
        print("Schema applied successfully.")
    finally:
        await conn.close()

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_schema())
