import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import path from "path";

interface RecipeInput {
  skuId: string;
  standardSku: string;
  flavor: string;
  qtyPerUnit: number;
}

interface Recipe {
  id: string;
  name: string;
  inputs: RecipeInput[];
  output: {
    skuId: string;
    standardSku: string;
    flavor: string;
  };
}

const RECIPES_PATH = path.join(
  process.cwd(),
  "clients/magna/config/wo-recipes.json"
);

async function readRecipes(): Promise<Recipe[]> {
  try {
    const data = await readFile(RECIPES_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeRecipes(recipes: Recipe[]): Promise<void> {
  await writeFile(RECIPES_PATH, JSON.stringify(recipes, null, 2) + "\n");
}

export async function GET() {
  const recipes = await readRecipes();
  return NextResponse.json(recipes);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  if (!body.name || !body.inputs?.length || !body.output?.skuId) {
    return NextResponse.json(
      { error: "Recipe requires a name, at least one input, and an output" },
      { status: 400 }
    );
  }

  const recipes = await readRecipes();

  const recipe: Recipe = {
    id: crypto.randomUUID(),
    name: body.name,
    inputs: body.inputs.map((i: RecipeInput) => ({
      skuId: i.skuId,
      standardSku: i.standardSku,
      flavor: i.flavor,
      qtyPerUnit: i.qtyPerUnit,
    })),
    output: {
      skuId: body.output.skuId,
      standardSku: body.output.standardSku,
      flavor: body.output.flavor,
    },
  };

  recipes.push(recipe);
  await writeRecipes(recipes);

  return NextResponse.json(recipe);
}
