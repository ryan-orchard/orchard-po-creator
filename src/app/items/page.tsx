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
}

const EMPTY_FORM = {
  standardSku: "",
  category: "",
  flavor: "",
  uom: "Each",
  count: "",
  description: "",
  status: "Active",
};

export default function ItemsListPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
      item.description?.toLowerCase().includes(q)
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

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError("");
    setModalOpen(true);
  }

  function openEdit(item: Item) {
    setEditing(item);
    setForm({
      standardSku: item.standardSku || "",
      category: item.category || "",
      flavor: item.flavor || "",
      uom: item.uom || "Each",
      count: item.count ? String(item.count) : "",
      description: item.description || "",
      status: item.status || "Active",
    });
    setError("");
    setModalOpen(true);
  }

  async function handleSave() {
    if (!form.standardSku.trim()) {
      setError("SKU is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = editing ? `/api/skus/${editing.id}` : "/api/skus";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      const saved: Item = await res.json();
      if (editing) {
        setItems((prev) => prev.map((i) => (i.id === saved.id ? saved : i)));
      } else {
        setItems((prev) => [...prev, saved].sort((a, b) => (a.standardSku || "").localeCompare(b.standardSku || "")));
      }
      setModalOpen(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

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
          <button
            onClick={openAdd}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-700"
          >
            + Add Item
          </button>
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
                    onClick={() => openEdit(item)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-semibold text-gray-900">
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
                    <td className="px-4 py-3 text-right text-gray-600">
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

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-5">
              {editing ? "Edit Item" : "Add Item"}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Standard SKU <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.standardSku}
                    onChange={(e) => setForm({ ...form, standardSku: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="e.g. ANS-STK-28-VAN"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    <option>Active</option>
                    <option>Review</option>
                    <option>Inactive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="e.g. Finished Good"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Flavor</label>
                  <input
                    type="text"
                    value={form.flavor}
                    onChange={(e) => setForm({ ...form, flavor: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="e.g. Vanilla"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">UOM</label>
                  <select
                    value={form.uom}
                    onChange={(e) => setForm({ ...form, uom: e.target.value, count: "" })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    <option>Each</option>
                    <option>Stick</option>
                    <option>Carton</option>
                  </select>
                </div>
                {form.uom === "Carton" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Sticks per Carton
                    </label>
                    <select
                      value={form.count}
                      onChange={(e) => setForm({ ...form, count: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                    >
                      <option value="">—</option>
                      <option>2</option>
                      <option>7</option>
                      <option>8</option>
                      <option>10</option>
                      <option>14</option>
                      <option>28</option>
                    </select>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : editing ? "Save Changes" : "Add Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
