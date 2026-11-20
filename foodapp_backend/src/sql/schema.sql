CREATE TABLE "global_ingredients" (
	"id" serial PRIMARY KEY,
	"blscode" text CONSTRAINT "global_ingredients_blscode_key" UNIQUE,
	"name" text NOT NULL,
	"category" text,
	"calories" numeric,
	"fat" numeric,
	"saturated_fat" numeric,
	"carbs" numeric,
	"sugars" numeric,
	"fiber" numeric,
	"protein" numeric,
	"salt" numeric
);
CREATE TABLE "items" (
	"id" serial PRIMARY KEY,
	"ingredient_id" integer NOT NULL,
	"users_id" integer NOT NULL,
	"quantity" numeric NOT NULL,
	"unit" text NOT NULL,
	"expiration_date" date,
	"storage_location" text DEFAULT 'fridge' NOT NULL,
	CONSTRAINT "items_ingredient_id_users_id_key" UNIQUE("ingredient_id","users_id"),
	CONSTRAINT "items_storage_location_check" CHECK ((storage_location = ANY (ARRAY['fridge'::text, 'freezer'::text, 'dry'::text])))
);
CREATE TABLE "preferences" (
	"users_id" integer,
	"allergies" text[] DEFAULT '{}' NOT NULL,
	"cuisines" text[] DEFAULT '{}' NOT NULL,
	"diets" text[] DEFAULT '{}' NOT NULL,
	"is_glutenfree" boolean DEFAULT false NOT NULL,
	CONSTRAINT "preferences_pkey1" PRIMARY KEY("users_id")
);
CREATE TABLE "recipe_cookings" (
	"id" bigserial PRIMARY KEY,
	"recipe_id" integer NOT NULL,
	"users_id" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"cooked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deducted_ingredients" jsonb DEFAULT '[]' NOT NULL,
	"is_legacy" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_recipe_cookings_user_idempotency" UNIQUE("users_id","idempotency_key")
);
CREATE TABLE "recipe_favourites" (
	"users_id" integer,
	"recipe_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_recipe_favourites" PRIMARY KEY("users_id","recipe_id")
);
CREATE TABLE "recipe_generation_requests" (
	"id" bigserial PRIMARY KEY,
	"users_id" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"generation_type" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"recipe_ids" integer[] DEFAULT ARRAY[] NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uq_recipe_generation_user_key" UNIQUE("users_id","idempotency_key"),
	CONSTRAINT "recipe_generation_requests_generation_type_check" CHECK ((generation_type = ANY (ARRAY['fridge'::text, 'selected'::text]))),
	CONSTRAINT "recipe_generation_requests_status_check" CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text])))
);
CREATE TABLE "recipe_view_history" (
	"id" bigserial PRIMARY KEY,
	"users_id" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_recipe_view_history_user_recipe" UNIQUE("users_id","recipe_id")
);
CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY,
	"source" text DEFAULT 'ai' NOT NULL,
	"request" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"users_id" integer,
	"cooked_at" timestamp with time zone
);
CREATE TABLE "saved_recipes" (
	"id" serial PRIMARY KEY,
	"users_id" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "saved_recipes_users_id_recipe_id_key" UNIQUE("users_id","recipe_id")
);
CREATE TABLE "users" (
	"id" serial PRIMARY KEY,
	"name" text NOT NULL,
	"lastname" text NOT NULL,
	"username" text NOT NULL CONSTRAINT "users_username_key" UNIQUE,
	"email" text NOT NULL CONSTRAINT "users_email_key" UNIQUE,
	"password" text NOT NULL
);