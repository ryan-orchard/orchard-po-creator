"use client";

import { useState, useEffect } from "react";

interface Item {
  id: string;
  standardSku: string;
  category: string;
  flavor: string;
  uom: string;
  count: string;
  description: string;
  status: string;
  supplierItemName: string;
}

export default function ItemsListPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/skus")
      .then((r) => r.json())
      .then((data) => {
        setItems(data);
        setLoading(false);
      });
  }, []);

  const filtered = items.filter((item) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      item.standardSku?.toLowerCase().includes(q) ||
      item.flavor?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q) ||
      item.supplierItemName?.toLowerCase().includes(q)
    );
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "Active":
        return "bg-green-50 text-green-700";
      case "Review":
        return "bg-yellow-50 text-yellow-700";
      case "Inactive":
        return "bg-gray-100 text-gray-500";
      default:
        return "bg-gray-100 text-gray-600";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Items</h1>
            <p className="text-sm text-gray-500 mt-1">
              {filtered.length} {filtered.length === 1 ? "item" : "items"}
              {search && ` matching "${search}"`}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by SKU, flavor, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
          />
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <p className="text-gray-500">
              {search ? "No items match your search." : "No items found."}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Flavor
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    UOM
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Sticks/Ctn
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-gray-100 hover:bg-gray-50"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                      {item.standardSku || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.category || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.flavor || "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.uom || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-600">
                      {item.count || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {item.status ? (
                        <span
                          className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${statusColor(item.status)}`}
                        >
                          {item.status}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
