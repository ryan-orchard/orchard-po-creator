"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface SKU {
  id: string;
  standardSku: string;
  category: string;
  flavor: string;
  count: number | null;
  uom: string;
  description: string;
}

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

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
  output: { skuId: string; standardSku: string; flavor: string };
}

// --- Input line: what goes into making 1 output unit ---
interface InputLine {
  key: string;
  skuId: string;
  sku?: SKU;
  qtyPerUnit: number; // how many of this input per 1 output
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const [skus, setSkus] = useState<SKU[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // WO Header
  const [warehouseId, setWarehouseId] = useState("");
  const [description, setDescription] = useState("");
  const [issuedDate, setIssuedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  // Recipe inputs: raw materials per 1 output unit
  const [inputLines, setInputLines] = useState<InputLine[]>([createEmptyInput()]);

  // Output
  const [outputSkuId, setOutputSkuId] = useState("");
  const [outputSku, setOutputSku] = useState<SKU | null>(null);
  const [outputQty, setOutputQty] = useState<number>(0);

  // Create new item inline
  const [showCreateItem, setShowCreateItem] = useState(false);
  const [newItem, setNewItem] = useState({
    standardSku: "",
    category: "",
    flavor: "",
    uom: "Carton",
    count: "",
    description: "",
  });
  const [creatingItem, setCreatingItem] = useState(false);

  // Save recipe
  const [showSaveRecipe, setShowSaveRecipe] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [savingRecipe, setSavingRecipe] = useState(false);

  // SKU search state
  const [inputSearch, setInputSearch] = useState<Record<string, string>>({});
  const [outputSearch, setOutputSearch] = useState("");
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);

  function createEmptyInput(): InputLine {
    return { key: crypto.randomUUID(), skuId: "", qtyPerUnit: 0 };
  }

  useEffect(() => {
    Promise.all([
      fetch("/api/skus").then((r) => r.json()),
      fetch("/api/ship-to").then((r) => r.json()),
      fetch("/api/work-orders/recipes").then((r) => r.json()),
    ]).then(([skuData, whData, recipeData]) => {
      setSkus(skuData);
      setWarehouses(whData);
      setRecipes(recipeData);
      const ans = whData.find((w: Warehouse) => w.code === "ANS");
      if (ans) setWarehouseId(ans.id);
      setLoading(false);
    });
  }, []);

  // --- Recipe loading ---
  const loadRecipe = useCallback(
    (recipeId: string) => {
      const recipe = recipes.find((r) => r.id === recipeId);
      if (!recipe) return;

      // Set output
      const oSku = skus.find((s) => s.id === recipe.output.skuId);
      setOutputSkuId(recipe.output.skuId);
      setOutputSku(oSku || null);

      // Set inputs
      setInputLines(
        recipe.inputs.map((inp) => ({
          key: crypto.randomUUID(),
          skuId: inp.skuId,
          sku: skus.find((s) => s.id === inp.skuId),
          qtyPerUnit: inp.qtyPerUnit,
        }))
      );

      setDescription(recipe.name);
    },
    [recipes, skus]
  );

  // --- Input management ---
  const updateInputLine = useCallback(
    (key: string, updates: Partial<InputLine>) => {
      setInputLines((prev) =>
        prev.map((item) => {
          if (item.key !== key) return item;
          const updated = { ...item, ...updates };
          if (updates.skuId) {
            updated.sku = skus.find((s) => s.id === updates.skuId);
          }
          return updated;
        })
      );
    },
    [skus]
  );

  const addInputLine = () =>
    setInputLines((prev) => [...prev, createEmptyInput()]);
  const removeInputLine = (key: string) =>
    setInputLines((prev) => prev.filter((i) => i.key !== key));

  // --- Output management ---
  const selectOutputSku = (skuId: string) => {
    const sku = skus.find((s) => s.id === skuId);
    setOutputSkuId(skuId);
    setOutputSku(sku || null);
    setOutputSearch("");
    setActiveDropdown(null);
  };

  // --- Calculated totals ---
  const calculatedInputs = inputLines
    .filter((il) => il.skuId && il.qtyPerUnit > 0)
    .map((il) => ({
      ...il,
      totalQty: il.qtyPerUnit * outputQty,
    }));

  // --- Create new item ---
  const handleCreateItem = async () => {
    if (!newItem.standardSku) {
      alert("Standard SKU is required.");
      return;
    }
    setCreatingItem(true);
    try {
      const res = await fetch("/api/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newItem,
          count:
            newItem.uom === "Carton" && newItem.count
              ? parseInt(newItem.count)
              : null,
          status: "Active",
        }),
      });
      const created = await res.json();
      // Add to local SKU list and select as output
      const newSku: SKU = {
        id: created.id,
        standardSku: created.standardSku,
        category: created.category,
        flavor: created.flavor,
        count: created.count,
        uom: created.uom,
        description: created.description,
      };
      setSkus((prev) => [...prev, newSku]);
      setOutputSkuId(created.id);
      setOutputSku(newSku);
      setShowCreateItem(false);
      setNewItem({
        standardSku: "",
        category: "",
        flavor: "",
        uom: "Carton",
        count: "",
        description: "",
      });
    } catch (err) {
      console.error(err);
      alert("Error creating item.");
    } finally {
      setCreatingItem(false);
    }
  };

  // --- Save recipe ---
  const handleSaveRecipe = async () => {
    if (!recipeName.trim()) {
      alert("Please enter a recipe name.");
      return;
    }
    const validInputs = inputLines.filter(
      (il) => il.skuId && il.qtyPerUnit > 0
    );
    if (validInputs.length === 0 || !outputSkuId) {
      alert("Recipe needs at least one input and an output.");
      return;
    }
    setSavingRecipe(true);
    try {
      const res = await fetch("/api/work-orders/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: recipeName,
          inputs: validInputs.map((il) => ({
            skuId: il.skuId,
            standardSku: il.sku?.standardSku || "",
            flavor: il.sku?.flavor || "",
            qtyPerUnit: il.qtyPerUnit,
          })),
          output: {
            skuId: outputSkuId,
            standardSku: outputSku?.standardSku || "",
            flavor: outputSku?.flavor || "",
          },
        }),
      });
      const saved = await res.json();
      setRecipes((prev) => [...prev, saved]);
      setShowSaveRecipe(false);
      setRecipeName("");
    } catch (err) {
      console.error(err);
      alert("Error saving recipe.");
    } finally {
      setSavingRecipe(false);
    }
  };

  // --- Submit WO ---
  const handleSubmit = async () => {
    const validInputs = inputLines.filter(
      (il) => il.skuId && il.qtyPerUnit > 0
    );
    if (!warehouseId || validInputs.length === 0 || !outputSkuId || outputQty <= 0) {
      alert("Please select a warehouse, define inputs, select an output, and enter a quantity.");
      return;
    }

    setSubmitting(true);
    try {
      const lineItems = [
        // Output line
        { skuId: outputSkuId, lineType: "Output" as const, qty: outputQty },
        // Input lines (multiplied by output qty)
        ...validInputs.map((il) => ({
          skuId: il.skuId,
          lineType: "Input" as const,
          qty: il.qtyPerUnit * outputQty,
        })),
      ];

      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId,
          description: description || `WO — ${outputSku?.standardSku || ""}`,
          issuedDate,
          lineItems,
        }),
      });

      const result = await res.json();
      router.push(`/work-orders/${result.id}`);
    } catch (err) {
      console.error(err);
      alert("Error creating Work Order.");
    } finally {
      setSubmitting(false);
    }
  };

  // --- SKU search helpers ---
  const filteredInputSkus = (key: string) => {
    const search = (inputSearch[key] || "").toLowerCase();
    if (!search) return skus.slice(0, 20);
    return skus.filter(
      (s) =>
        s.standardSku?.toLowerCase().includes(search) ||
        s.flavor?.toLowerCase().includes(search) ||
        s.category?.toLowerCase().includes(search)
    );
  };

  const filteredOutputSkus = () => {
    const search = outputSearch.toLowerCase();
    if (!search) return skus.slice(0, 20);
    return skus.filter(
      (s) =>
        s.standardSku?.toLowerCase().includes(search) ||
        s.flavor?.toLowerCase().includes(search) ||
        s.category?.toLowerCase().includes(search)
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Create Work Order
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              WO number will be auto-generated on save
            </p>
          </div>
          <button
            onClick={() => router.push("/work-orders")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to Work Orders
          </button>
        </div>

        {/* Load Recipe */}
        {recipes.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-5 py-4 mb-6">
            <label className="block text-sm font-medium text-blue-800 mb-1">
              Load Saved Recipe
            </label>
            <select
              onChange={(e) => {
                if (e.target.value) loadRecipe(e.target.value);
              }}
              className="w-full border border-blue-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a recipe to pre-fill...</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} → {r.output.standardSku}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* WO Header */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Work Order Details
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Warehouse *
              </label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="">Select warehouse...</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Issued Date
              </label>
              <input
                type="date"
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g., Kit 28ct Cartons - Lemon Lime"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>
        </div>

        {/* Step 1: Inputs — per 1 output unit */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
                Step 1: Define Inputs (per 1 output unit)
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                What raw materials go into making 1 unit of the finished good?
              </p>
            </div>
            <button
              onClick={addInputLine}
              className="text-sm bg-gray-900 text-white px-3 py-1.5 rounded-md hover:bg-gray-800"
            >
              + Add Input
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-warm-800 text-white">
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                  Input SKU
                </th>
                <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                  UOM
                </th>
                <th className="text-right px-3 py-2 text-xs font-semibold uppercase tracking-wider">
                  Qty per 1 Output
                </th>
                <th className="px-3 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {inputLines.map((item) => (
                <tr key={item.key} className="border-b border-gray-100">
                  <td className="px-3 py-2 relative min-w-[300px]">
                    <input
                      type="text"
                      value={
                        item.sku
                          ? `${item.sku.standardSku} — ${item.sku.flavor}`
                          : inputSearch[item.key] || ""
                      }
                      onChange={(e) => {
                        setInputSearch((prev) => ({
                          ...prev,
                          [item.key]: e.target.value,
                        }));
                        setActiveDropdown(`input-${item.key}`);
                        if (item.skuId) {
                          updateInputLine(item.key, {
                            skuId: "",
                            sku: undefined,
                          });
                        }
                      }}
                      onFocus={() => setActiveDropdown(`input-${item.key}`)}
                      onBlur={() =>
                        setTimeout(() => setActiveDropdown(null), 200)
                      }
                      placeholder="Search SKU..."
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-black"
                    />
                    {activeDropdown === `input-${item.key}` && (
                      <div className="absolute z-50 mt-1 w-96 max-h-60 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-xl">
                        {filteredInputSkus(item.key).map((sku) => (
                          <button
                            key={sku.id}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs border-b border-gray-50"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              updateInputLine(item.key, { skuId: sku.id });
                              setInputSearch((prev) => ({
                                ...prev,
                                [item.key]: "",
                              }));
                              setActiveDropdown(null);
                            }}
                          >
                            <span className="font-semibold">
                              {sku.standardSku}
                            </span>
                            <span className="text-gray-500 ml-2">
                              {sku.flavor} · {sku.uom} · {sku.category}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {item.sku?.uom || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={item.qtyPerUnit || ""}
                      onChange={(e) =>
                        updateInputLine(item.key, {
                          qtyPerUnit: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-full border border-gray-300 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-2 focus:ring-black"
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {inputLines.length > 1 && (
                      <button
                        onClick={() => removeInputLine(item.key)}
                        className="text-gray-400 hover:text-red-500 text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Step 2: Output — finished good */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Step 2: Define Output
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            The finished good this work order produces. Select an existing item
            or create a new one.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Output SKU *
              </label>
              {outputSku ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 border border-sage-300 bg-sage-50 rounded-md px-3 py-2 text-sm">
                    <span className="font-semibold">
                      {outputSku.standardSku}
                    </span>
                    <span className="text-gray-500 ml-2">
                      {outputSku.flavor}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setOutputSkuId("");
                      setOutputSku(null);
                    }}
                    className="text-gray-400 hover:text-red-500 text-sm px-2"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={outputSearch}
                    onChange={(e) => {
                      setOutputSearch(e.target.value);
                      setActiveDropdown("output");
                    }}
                    onFocus={() => setActiveDropdown("output")}
                    onBlur={() =>
                      setTimeout(() => setActiveDropdown(null), 200)
                    }
                    placeholder="Search existing SKU..."
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                  {activeDropdown === "output" && (
                    <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-gray-300 rounded-md shadow-xl">
                      <button
                        className="w-full text-left px-3 py-2 hover:bg-sage-50 text-xs border-b border-gray-100 font-semibold text-sage-700"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setShowCreateItem(true);
                          setActiveDropdown(null);
                        }}
                      >
                        + Create New Item...
                      </button>
                      {filteredOutputSkus().map((sku) => (
                        <button
                          key={sku.id}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs border-b border-gray-50"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectOutputSku(sku.id);
                          }}
                        >
                          <span className="font-semibold">
                            {sku.standardSku}
                          </span>
                          <span className="text-gray-500 ml-2">
                            {sku.flavor} · {sku.uom} · {sku.category}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity to Produce *
              </label>
              <input
                type="number"
                value={outputQty || ""}
                onChange={(e) => setOutputQty(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
          </div>

          {/* Create New Item Inline */}
          {showCreateItem && (
            <div className="mt-4 p-4 border border-sage-200 bg-sage-50 rounded-lg">
              <h3 className="text-sm font-semibold text-sage-800 mb-3">
                Create New Item
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Standard SKU *
                  </label>
                  <input
                    type="text"
                    value={newItem.standardSku}
                    onChange={(e) =>
                      setNewItem((prev) => ({
                        ...prev,
                        standardSku: e.target.value,
                      }))
                    }
                    placeholder="e.g., ELEC-VARIETY-28"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Category
                  </label>
                  <select
                    value={newItem.category}
                    onChange={(e) =>
                      setNewItem((prev) => ({
                        ...prev,
                        category: e.target.value,
                      }))
                    }
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  >
                    <option value="">Select...</option>
                    <option value="Electrolyte">Electrolyte</option>
                    <option value="Creatine">Creatine</option>
                    <option value="Packaging">Packaging</option>
                    <option value="Merch">Merch</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Flavor
                  </label>
                  <input
                    type="text"
                    value={newItem.flavor}
                    onChange={(e) =>
                      setNewItem((prev) => ({
                        ...prev,
                        flavor: e.target.value,
                      }))
                    }
                    placeholder="e.g., Variety"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    UOM
                  </label>
                  <select
                    value={newItem.uom}
                    onChange={(e) =>
                      setNewItem((prev) => ({ ...prev, uom: e.target.value }))
                    }
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  >
                    <option value="Carton">Carton</option>
                    <option value="Stick">Stick</option>
                    <option value="Each">Each</option>
                  </select>
                </div>
                {newItem.uom === "Carton" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Sticks per Carton
                    </label>
                    <input
                      type="number"
                      value={newItem.count}
                      onChange={(e) =>
                        setNewItem((prev) => ({
                          ...prev,
                          count: e.target.value,
                        }))
                      }
                      placeholder="e.g., 28"
                      className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={newItem.description}
                    onChange={(e) =>
                      setNewItem((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Full name"
                    className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleCreateItem}
                  disabled={creatingItem || !newItem.standardSku}
                  className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
                >
                  {creatingItem ? "Creating..." : "Create & Select"}
                </button>
                <button
                  onClick={() => setShowCreateItem(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Calculated Summary */}
        {outputQty > 0 && calculatedInputs.length > 0 && (
          <div className="bg-gray-900 text-white rounded-lg p-6 mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider opacity-70 mb-3">
              Calculated Requirements
            </h2>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs uppercase tracking-wider opacity-50 mb-2">
                  Inputs Required
                </p>
                {calculatedInputs.map((il) => (
                  <div
                    key={il.key}
                    className="flex justify-between items-center py-1 border-b border-white/10"
                  >
                    <span className="text-sm">
                      {il.sku?.standardSku}{" "}
                      <span className="opacity-50">{il.sku?.flavor}</span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums">
                      {il.totalQty.toLocaleString()}{" "}
                      <span className="opacity-50 text-xs">
                        ({il.qtyPerUnit} × {outputQty.toLocaleString()})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider opacity-50 mb-2">
                  Output
                </p>
                <div className="flex justify-between items-center py-1">
                  <span className="text-sm">
                    {outputSku?.standardSku}{" "}
                    <span className="opacity-50">{outputSku?.flavor}</span>
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {outputQty.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between">
          <div>
            {!showSaveRecipe ? (
              <button
                onClick={() => setShowSaveRecipe(true)}
                disabled={
                  inputLines.every((il) => !il.skuId || il.qtyPerUnit <= 0) ||
                  !outputSkuId
                }
                className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Save as Recipe
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={recipeName}
                  onChange={(e) => setRecipeName(e.target.value)}
                  placeholder="Recipe name..."
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
                <button
                  onClick={handleSaveRecipe}
                  disabled={savingRecipe || !recipeName.trim()}
                  className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
                >
                  {savingRecipe ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setShowSaveRecipe(false);
                    setRecipeName("");
                  }}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push("/work-orders")}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50"
            >
              {submitting ? "Creating..." : "Create Work Order"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
