"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface BOM {
  finishedGoodId: string;
  finishedGoodSku: string;
  finishedGoodName: string;
  uom: string;
  isActive: boolean;
  componentCount: number;
  components: {
    componentId: string;
    componentSku: string;
    componentName: string;
    uom: string;
    qtyPerOutput: number;
  }[];
}

export default function BOMs() {
  const router = useRouter();
  const [boms, setBoms] = useState<BOM[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/boms")
      .then((r) => r.json())
      .then((data) => {
        setBoms(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-screen-2xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bills of Materials</h1>
            <p className="text-sm text-gray-500 mt-1">Recipes used to generate Work Order inputs</p>
          </div>
          <button
            onClick={() => router.push("/boms/new")}
            className="px-4 py-2 bg-sage-800 text-white text-sm font-medium rounded-md hover:bg-sage-700"
          >
            + New BOM
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 py-12 text-center">Loading…</div>
        ) : boms.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 py-16 text-center">
            <p className="text-gray-500 text-sm mb-3">No BOMs yet.</p>
            <button
              onClick={() => router.push("/boms/new")}
              className="text-sm text-sage-700 hover:underline"
            >
              Create your first BOM →
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sage-800 text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">SKU</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">UOM</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider">Components</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {boms.map((bom) => (
                  <tr key={bom.finishedGoodId} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-900">
                      {bom.finishedGoodSku}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{bom.finishedGoodName}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{bom.uom}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {bom.componentCount}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${
                        bom.isActive
                          ? "bg-sage-100 text-sage-800"
                          : "bg-gray-100 text-gray-500"
                      }`}>
                        {bom.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/boms/${bom.finishedGoodId}`}
                        className="text-xs text-sage-700 hover:underline font-medium"
                      >
                        Edit
                      </Link>
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
